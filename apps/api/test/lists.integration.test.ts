import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface Item {
  id: string;
  label: string;
  checked: boolean;
  sortOrder: number;
  quantity: number;
  unit: string | null;
  section: string | null;
  priceMinor: number | null;
  checkedById: string | null;
  checkedByName: string | null;
  expenseTransactionId: string | null;
  inventoryItemId: string | null;
  stocked: boolean;
}
interface ListDto {
  id: string;
  name: string;
  kind: string;
  isTemplate: boolean;
  sortOrder: number;
  archivedAt: string | null;
  items: Item[];
}

/**
 * «Списки»: manual order, bulk add, who ticked what, «Отменить» that restores whole entries, templates,
 * archive-then-delete, workspace isolation, and the «Покупки → Финансы» plugin (one expense per receipt,
 * never booked twice, 409 with the plugin or Finance off).
 */
describe("Lists (full module + lists-finance plugin)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `lists-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: ["error"] });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true } });
        if (users.length === 0) return;
        const userIds = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
  });

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function setup(name: string) {
    const response = await request<{ accessToken: string }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const token = response.data.accessToken;
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token });
    const ws = workspaces.data[0]!.id;
    const call = <T = unknown>(method: string, path: string, body?: unknown) => request<T>(`/workspaces/${ws}${path}`, { method, token, body });
    return { ws, token, call };
  }

  async function newList(call: Awaited<ReturnType<typeof setup>>["call"], name: string, labels: string[] = []) {
    const list = await call<ListDto>("POST", "/lists", { name });
    expect(list.status).toBe(201);
    if (labels.length > 0) {
      const bulk = await call<Item[]>("POST", `/lists/${list.data.id}/items/bulk`, { items: labels.map((label) => ({ label })) });
      expect(bulk.status).toBe(201);
    }
    const reread = await call<ListDto>("GET", `/lists/${list.data.id}`);
    return reread.data;
  }

  it("keeps entries in the order they were added, reorders them, and refuses foreign ids", async () => {
    const { call } = await setup("order");
    const list = await newList(call, "Продукты", ["Хлеб", "Молоко", "Сыр"]);
    expect(list.items.map((item) => item.label)).toEqual(["Хлеб", "Молоко", "Сыр"]);

    const [bread, milk, cheese] = list.items as [Item, Item, Item];
    const moved = await call<ListDto>("PUT", `/lists/${list.id}/items/order`, { ids: [cheese.id, bread.id, milk.id] });
    expect(moved.status).toBe(200);
    expect(moved.data.items.map((item) => item.label)).toEqual(["Сыр", "Хлеб", "Молоко"]);

    const added = await call<Item>("POST", `/lists/${list.id}/items`, { label: "Яйца", quantity: 10, unit: "шт", section: "Молочка", priceMinor: 9000 });
    expect(added.data).toMatchObject({ quantity: 10, unit: "шт", section: "Молочка", priceMinor: 9000 });
    const afterAdd = await call<ListDto>("GET", `/lists/${list.id}`);
    expect(afterAdd.data.items.at(-1)?.label).toBe("Яйца");

    const bad = await call("PUT", `/lists/${list.id}/items/order`, { ids: [cheese.id, "no-such-item"] });
    expect(bad.status).toBe(404);

    const second = await newList(call, "Дела");
    const lists = await call<ListDto[]>("GET", "/lists");
    expect(lists.data.map((l) => l.name)).toEqual(["Продукты", "Дела"]);
    const reorder = await call("PUT", "/lists/order", { ids: [second.id, list.id] });
    expect(reorder.status).toBe(200);
    expect((await call<ListDto[]>("GET", "/lists")).data.map((l) => l.name)).toEqual(["Дела", "Продукты"]);
  });

  it("records who ticked an entry and keeps the first person on a repeated tick", async () => {
    const { call } = await setup("who");
    const list = await newList(call, "Покупки", ["Хлеб"]);
    const item = list.items[0]!;
    const ticked = await call<Item>("PATCH", `/lists/${list.id}/items/${item.id}`, { checked: true });
    expect(ticked.data.checked).toBe(true);
    expect(ticked.data.checkedById).not.toBeNull();
    expect(ticked.data.checkedByName).toBe("who");
    const again = await call<Item>("PATCH", `/lists/${list.id}/items/${item.id}`, { checked: true });
    expect(again.data.checkedById).toBe(ticked.data.checkedById);
    const unticked = await call<Item>("PATCH", `/lists/${list.id}/items/${item.id}`, { checked: false });
    expect(unticked.data).toMatchObject({ checked: false, checkedById: null, checkedByName: null });
  });

  it("«Очистить отмеченные» returns whole entries and restoring them keeps ids, order and extras; «Новый круг» resets", async () => {
    const { call } = await setup("undo");
    const list = await newList(call, "Покупки", ["Хлеб", "Молоко", "Сыр"]);
    const [bread, milk, cheese] = list.items as [Item, Item, Item];
    await call("PATCH", `/lists/${list.id}/items/${milk.id}`, { checked: true, note: "жирность 3.2", priceMinor: 8000, quantity: 2, unit: "л" });
    await call("PATCH", `/lists/${list.id}/items/${cheese.id}`, { checked: true });

    const cleared = await call<{ removed: Array<{ id: string; label: string; note: string; priceMinor: number | null; quantity: number; unit: string | null; sortOrder: number }> }>(
      "POST",
      `/lists/${list.id}/items/clear-checked`
    );
    expect(cleared.status).toBe(201);
    expect(cleared.data.removed.map((item) => item.label)).toEqual(["Молоко", "Сыр"]);
    expect((await call<ListDto>("GET", `/lists/${list.id}`)).data.items.map((item) => item.label)).toEqual(["Хлеб"]);

    const restored = await call<ListDto>("POST", `/lists/${list.id}/items/restore`, { items: cleared.data.removed.map((item) => ({ ...item, checked: true, stockedMovementId: null, inventoryItemId: null, expenseTransactionId: null, dueAt: null, section: null, checkedAt: null, checkedById: null })) });
    expect(restored.status).toBe(201);
    expect(restored.data.items.map((item) => item.id)).toEqual([bread.id, milk.id, cheese.id]);
    const restoredMilk = restored.data.items.find((item) => item.id === milk.id)!;
    expect(restoredMilk).toMatchObject({ quantity: 2, unit: "л", priceMinor: 8000, checked: true });

    // A second restore of the same snapshot adds nothing (ids exist again).
    const twice = await call<ListDto>("POST", `/lists/${list.id}/items/restore`, { items: cleared.data.removed.map((item) => ({ ...item, checked: true, stockedMovementId: null, inventoryItemId: null, expenseTransactionId: null, dueAt: null, section: null, checkedAt: null, checkedById: null })) });
    expect(twice.data.items).toHaveLength(3);

    const reset = await call<ListDto>("POST", `/lists/${list.id}/reset`);
    expect(reset.data.items.every((item) => !item.checked && item.checkedById === null)).toBe(true);
    expect(reset.data.items).toHaveLength(3);
  });

  it("restore never trusts a stock or expense id from another workspace", async () => {
    const a = await setup("restore-a");
    const b = await setup("restore-b");
    const stock = await b.call<{ id: string }>("POST", "/inventory/items", { name: "Чужая позиция" });
    const list = await newList(a.call, "Мои", ["Хлеб"]);
    const restored = await a.call<ListDto>("POST", `/lists/${list.id}/items/restore`, {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          label: "Подмена",
          checked: false,
          sortOrder: 999,
          quantity: 1,
          unit: null,
          note: "",
          dueAt: null,
          section: null,
          priceMinor: null,
          inventoryItemId: stock.data.id,
          stockedMovementId: null,
          expenseTransactionId: null,
          checkedAt: null,
          checkedById: null
        }
      ]
    });
    expect(restored.status).toBe(201);
    expect(restored.data.items.find((item) => item.label === "Подмена")?.inventoryItemId).toBeNull();
  });

  it("builds a list from a template, saves a copy as a template, and deletes only archived lists or templates", async () => {
    const { call } = await setup("template");
    const base = await newList(call, "Поездка", ["Паспорт", "Зарядка"]);
    await call("PATCH", `/lists/${base.id}`, { kind: "packing" });
    await call("PATCH", `/lists/${base.id}/items/${base.items[0]!.id}`, { checked: true });

    const template = await call<ListDto>("POST", `/lists/${base.id}/duplicate`, { asTemplate: true });
    expect(template.data).toMatchObject({ isTemplate: true, kind: "packing" });
    expect(template.data.items.every((item) => !item.checked)).toBe(true);
    expect((await call<ListDto[]>("GET", "/lists")).data.map((l) => l.id)).not.toContain(template.data.id);
    expect((await call<ListDto[]>("GET", "/lists?templates=true")).data.map((l) => l.id)).toEqual([template.data.id]);

    const fromTemplate = await call<ListDto>("POST", "/lists", { name: "Отпуск", templateId: template.data.id });
    expect(fromTemplate.data).toMatchObject({ kind: "packing", isTemplate: false });
    expect(fromTemplate.data.items.map((item) => item.label)).toEqual(["Паспорт", "Зарядка"]);

    expect((await call("DELETE", `/lists/${base.id}/permanent`)).status).toBe(409);
    expect((await call("DELETE", `/lists/${base.id}`)).status).toBe(200);
    expect((await call("DELETE", `/lists/${base.id}/permanent`)).status).toBe(200);
    expect((await call("DELETE", `/lists/${template.data.id}/permanent`)).status).toBe(200);
    expect((await call("GET", `/lists/${base.id}`)).status).toBe(404);
  });

  it("caps a list's entries and rejects a bulk request that would exceed it", async () => {
    const { call } = await setup("cap");
    const list = await newList(call, "Много");
    const tooMany = await call("POST", `/lists/${list.id}/items/bulk`, { items: Array.from({ length: 201 }, (_, i) => ({ label: `п${i}` })) });
    expect(tooMany.status).toBe(400);
  });

  it("does not let a member of two workspaces touch a list of the other one", async () => {
    const a = await setup("iso-a");
    const b = await setup("iso-b");
    const list = await newList(a.call, "Мои", ["Хлеб"]);
    expect((await b.call("GET", `/lists/${list.id}`)).status).toBe(404);
    expect((await b.call("POST", `/lists/${list.id}/items`, { label: "Чужой" })).status).toBe(404);
    expect((await b.call("PUT", `/lists/order`, { ids: [list.id] })).status).toBe(404);
  });

  it("searches lists by name and by entry text", async () => {
    const { call } = await setup("search");
    await newList(call, "Ремонт", ["Шпатлёвка финишная"]);
    const byItem = await call<Array<{ type: string; title: string }>>("GET", "/search?q=" + encodeURIComponent("Шпатл"));
    expect(byItem.data.some((hit) => hit.type === "list" && hit.title === "Ремонт")).toBe(true);
  });

  describe("«Покупки → Финансы»", () => {
    async function finance(name: string) {
      const ctx = await setup(name);
      const account = await ctx.call<{ id: string }>("POST", "/finance/accounts", { name: "Карта", startingBalance: 1_000_000 });
      const expenseCategory = await ctx.call<{ id: string }>("POST", "/finance/categories", { name: "Продукты", kind: "expense" });
      const incomeCategory = await ctx.call<{ id: string }>("POST", "/finance/categories", { name: "Зарплата", kind: "income" });
      expect([account.status, expenseCategory.status, incomeCategory.status]).toEqual([201, 201, 201]);
      const list = await newList(ctx.call, "Продукты", ["Хлеб", "Молоко", "Сыр"]);
      const [bread, milk, cheese] = list.items as [Item, Item, Item];
      return { ...ctx, accountId: account.data.id, categoryId: expenseCategory.data.id, incomeCategoryId: incomeCategory.data.id, listId: list.id, bread, milk, cheese };
    }

    it("books bought entries as one expense, once — also under a race — and marks them", async () => {
      const f = await finance("fin");
      await f.call("PATCH", `/lists/${f.listId}/items/${f.bread.id}`, { checked: true, priceMinor: 5000 });
      await f.call("PATCH", `/lists/${f.listId}/items/${f.milk.id}`, { checked: true, priceMinor: 8000 });
      const path = `/lists-finance/lists/${f.listId}/expense`;
      const input = { itemIds: [f.bread.id, f.milk.id], accountId: f.accountId, categoryId: f.categoryId };

      const results = await Promise.all([f.call<{ transactionId: string; amountMinor: number }>("POST", path, input), f.call<{ transactionId: string }>("POST", path, input)]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      const ok = results.find((r) => r.status === 201)!.data as { transactionId: string; amountMinor: number };
      expect(ok.amountMinor).toBe(13000);

      const transactions = await f.call<Array<{ id: string; type: string; lines: Array<{ amount: number; categoryId: string | null }> }>>("GET", "/finance/transactions");
      const booked = transactions.data.filter((t) => t.id === ok.transactionId);
      expect(booked).toHaveLength(1);
      expect(booked[0]).toMatchObject({ type: "expense" });
      expect(booked[0]!.lines).toEqual([expect.objectContaining({ amount: 13000, categoryId: f.categoryId })]);

      const reread = (await f.call<ListDto>("GET", `/lists/${f.listId}`)).data;
      expect(reread.items.filter((item) => item.expenseTransactionId === ok.transactionId).map((item) => item.label)).toEqual(["Хлеб", "Молоко"]);
      expect(reread.items.find((item) => item.label === "Сыр")?.expenseTransactionId).toBeNull();

      // «Новый круг» forgets the booking of the entries; the expense itself stays in Finance.
      await f.call("POST", `/lists/${f.listId}/reset`);
      expect((await f.call<ListDto>("GET", `/lists/${f.listId}`)).data.items.every((item) => item.expenseTransactionId === null)).toBe(true);
      expect((await f.call<Array<{ id: string }>>("GET", "/finance/transactions")).data.some((t) => t.id === ok.transactionId)).toBe(true);
    });

    it("needs a total when a price is unknown, rejects income categories and foreign ids, and books ticked-on-the-fly entries", async () => {
      const f = await finance("fin-rules");
      const path = `/lists-finance/lists/${f.listId}/expense`;
      const noPrice = await f.call("POST", path, { itemIds: [f.cheese.id], accountId: f.accountId });
      expect(noPrice.status).toBe(400);
      const wrongKind = await f.call("POST", path, { itemIds: [f.cheese.id], accountId: f.accountId, categoryId: f.incomeCategoryId, amountMinor: 1000 });
      expect(wrongKind.status).toBe(400);
      const foreign = await f.call("POST", path, { itemIds: ["nope"], accountId: f.accountId, amountMinor: 1000 });
      expect(foreign.status).toBe(404);

      const booked = await f.call<{ amountMinor: number; items: Item[] }>("POST", path, { itemIds: [f.cheese.id], accountId: f.accountId, amountMinor: 25000 });
      expect(booked.status).toBe(201);
      expect(booked.data.items[0]).toMatchObject({ label: "Сыр", checked: true });
      expect(booked.data.items[0]!.checkedById).not.toBeNull();
    });

    it("answers 409 with the plugin or the Finance module off, without touching stored marks", async () => {
      const f = await finance("fin-off");
      const path = `/lists-finance/lists/${f.listId}/expense`;
      const input = { itemIds: [f.bread.id], accountId: f.accountId, amountMinor: 5000 };
      const first = await f.call<{ transactionId: string }>("POST", path, input);
      expect(first.status).toBe(201);

      expect((await f.call("PATCH", "/plugins/lists-finance", { enabled: false })).status).toBe(200);
      expect((await f.call("POST", path, { ...input, itemIds: [f.milk.id] })).status).toBe(409);
      expect((await f.call("PATCH", "/plugins/lists-finance", { enabled: true })).status).toBe(200);

      expect((await f.call("PATCH", "/modules/finance", { enabled: false })).status).toBe(200);
      expect((await f.call("POST", path, { ...input, itemIds: [f.milk.id] })).status).toBe(409);
      expect((await f.call("PATCH", "/modules/finance", { enabled: true })).status).toBe(200);

      const reread = (await f.call<ListDto>("GET", `/lists/${f.listId}`)).data;
      expect(reread.items.find((item) => item.id === f.bread.id)?.expenseTransactionId).toBe(first.data.transactionId);
    });
  });
});

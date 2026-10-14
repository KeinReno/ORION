import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Plugin «Покупки → Склад» (lists-inventory): a shopping-list entry linked to a
 * stock item restocks it exactly once when bought, links never cross
 * workspaces, and the bridge is off (409) whenever Lists, Inventory or the
 * plugin itself is off — without touching stored links or receipts.
 */
describe("Lists ↔ Inventory bridge (lists-inventory plugin)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `lists-inventory-${runId}`;

  beforeAll(async () => {
    // Errors only: a 500 under concurrency must leave its stack in the CI log.
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
    const list = await call<{ id: string }>("POST", "/lists", { name: "Покупки" });
    const stock = await call<{ id: string }>("POST", "/inventory/items", { name: "Фильтр для воды", minStock: 2 });
    const entry = await call<{ id: string }>("POST", `/lists/${list.data.id}/items`, { label: "Фильтр" });
    expect([list.status, stock.status, entry.status]).toEqual([201, 201, 201]);
    const balance = async () => {
      const items = await call<Array<{ id: string; balance: number }>>("GET", "/inventory/items");
      return items.data.find((item) => item.id === stock.data.id)!.balance;
    };
    return { ws, call, listId: list.data.id, stockId: stock.data.id, entryId: entry.data.id, balance };
  }

  it("buying a linked entry restocks once; re-buying, unticking and unlinking never double-count or erase the receipt", async () => {
    const { call, listId, stockId, entryId, balance } = await setup("buy");
    const base = `/lists-inventory/lists/${listId}/items/${entryId}`;

    const unlinked = await call("POST", `${base}/purchase`);
    expect(unlinked.status).toBe(400);

    const linked = await call<{ inventoryItemId: string; quantity: number; stocked: boolean }>("PUT", `${base}/link`, { inventoryItemId: stockId, quantity: 3 });
    expect(linked.status).toBe(200);
    expect(linked.data).toMatchObject({ inventoryItemId: stockId, quantity: 3, stocked: false });

    const bought = await call<{ item: { checked: boolean; stocked: boolean }; movement: { quantity: number; type: string; note: string } | null }>("POST", `${base}/purchase`);
    expect(bought.status).toBe(201);
    expect(bought.data.item).toMatchObject({ checked: true, stocked: true });
    expect(bought.data.movement).toMatchObject({ type: "receipt", quantity: 3, note: "Куплено по списку «Покупки»" });
    expect(await balance()).toBe(3);

    // Same click again, or two windows racing: no second receipt.
    const [again, race] = await Promise.all([call<{ movement: unknown }>("POST", `${base}/purchase`), call<{ movement: unknown }>("POST", `${base}/purchase`)]);
    expect([again.status, race.status]).toEqual([201, 201]);
    expect(again.data.movement).toBeNull();
    expect(race.data.movement).toBeNull();
    expect(await balance()).toBe(3);

    // Unticking through the plain Lists API keeps the receipt; buying again stays a no-op for stock.
    expect((await call("PATCH", `/lists/${listId}/items/${entryId}`, { checked: false })).status).toBe(200);
    await call("POST", `${base}/purchase`);
    expect(await balance()).toBe(3);

    const unlink = await call<{ inventoryItemId: string | null; stocked: boolean }>("PUT", `${base}/link`, { inventoryItemId: null });
    expect(unlink.data).toMatchObject({ inventoryItemId: null, stocked: true });
    expect(await balance()).toBe(3);
  });

  it("concurrent first purchases write exactly one receipt", async () => {
    const { call, listId, stockId, entryId, balance } = await setup("race");
    const base = `/lists-inventory/lists/${listId}/items/${entryId}`;
    await call("PUT", `${base}/link`, { inventoryItemId: stockId, quantity: 2 });
    const results = await Promise.all([1, 2, 3].map(() => call<{ movement: unknown }>("POST", `${base}/purchase`)));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(results.filter((r) => r.data.movement !== null)).toHaveLength(1);
    expect(await balance()).toBe(2);
  });

  it("«В список покупок» asks for enough to clear the threshold and does not duplicate an open entry", async () => {
    const { call, listId, stockId } = await setup("tolist");
    const first = await call<{ id: string; label: string; quantity: number; inventoryItemId: string }>("POST", `/lists-inventory/inventory/${stockId}/to-list`, { listId });
    expect(first.status).toBe(201);
    // balance 0, minStock 2 → buy 3 to end above the threshold.
    expect(first.data).toMatchObject({ label: "Фильтр для воды", quantity: 3, inventoryItemId: stockId });
    const second = await call<{ id: string }>("POST", `/lists-inventory/inventory/${stockId}/to-list`, { listId });
    expect(second.data.id).toBe(first.data.id);
    const explicit = await call<{ quantity: number }>("PUT", `/lists-inventory/lists/${listId}/items/${first.data.id}/link`, { inventoryItemId: stockId, quantity: 5 });
    expect(explicit.data.quantity).toBe(5);
  });

  it("links never cross workspaces", async () => {
    const a = await setup("ws-a");
    const b = await setup("ws-b");
    const foreign = await a.call("PUT", `/lists-inventory/lists/${a.listId}/items/${a.entryId}/link`, { inventoryItemId: b.stockId });
    expect(foreign.status).toBe(404);
    const foreignList = await a.call("POST", `/lists-inventory/inventory/${a.stockId}/to-list`, { listId: b.listId });
    expect(foreignList.status).toBe(404);
  });

  it("is off with the plugin or the Inventory module off; stored links and receipts survive", async () => {
    const { call, listId, stockId, entryId, balance } = await setup("gates");
    const base = `/lists-inventory/lists/${listId}/items/${entryId}`;
    await call("PUT", `${base}/link`, { inventoryItemId: stockId, quantity: 1 });
    await call("POST", `${base}/purchase`);
    expect(await balance()).toBe(1);

    expect((await call("PATCH", "/plugins/lists-inventory", { enabled: false })).status).toBe(200);
    expect((await call("POST", `${base}/purchase`)).status).toBe(409);
    const lists = await call<Array<{ items: Array<{ id: string; inventoryItemId: string | null; stocked: boolean }> }>>("GET", "/lists");
    expect(lists.data[0]!.items.find((item) => item.id === entryId)).toMatchObject({ inventoryItemId: stockId, stocked: true });
    expect((await call("PATCH", "/plugins/lists-inventory", { enabled: true })).status).toBe(200);

    expect((await call("PATCH", "/modules/inventory", { enabled: false })).status).toBe(200);
    expect((await call("POST", `/lists-inventory/inventory/${stockId}/to-list`, { listId })).status).toBe(409);
    expect((await call("PATCH", "/modules/inventory", { enabled: true })).status).toBe(200);
    expect(await balance()).toBe(1);
  });
});

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface RegisteredSession {
  accessToken: string;
  user: { id: string; name: string };
  email: string;
  workspaceId: string;
}

describe("Module Home", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `home-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
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

  interface Overview {
    home: { id: string; name: string };
    taskIds: string[];
    listIds: string[];
    inventoryIds: string[];
    obligationIds: string[];
    elsewhere: { taskIds: string[]; listIds: string[]; inventoryIds: string[]; obligationIds: string[] };
    meters: Array<{ id: string; unit: string; lastValue: number | null; readings: Array<{ id: string; value: number; consumption: number | null }> }>;
    contacts: Array<{ id: string; name: string }>;
  }

  it("дом собирает дела, списки, вещи и платежи, созданные прямо с homeId; чужой дом отклоняется", async () => {
    const alice = await register("alice");
    const mallory = await register("mallory");
    const ws = `/workspaces/${alice.workspaceId}`;
    const home = await request<{ id: string }>(`${ws}/homes`, { method: "POST", token: alice.accessToken, body: { name: "Квартира", kind: "flat" } });
    expect(home.status).toBe(201);
    expect((await request(`${ws}/homes`, { method: "POST", token: alice.accessToken, body: { name: "квартира" } })).status).toBe(409);
    const foreignHome = await request<{ id: string }>(`/workspaces/${mallory.workspaceId}/homes`, { method: "POST", token: mallory.accessToken, body: { name: "Чужой" } });

    const task = await request<{ id: string }>(`${ws}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Вынести мусор", homeId: home.data.id } });
    const list = await request<{ id: string }>(`${ws}/lists`, { method: "POST", token: alice.accessToken, body: { name: "Купить", homeId: home.data.id } });
    const thing = await request<{ id: string }>(`${ws}/inventory/items`, { method: "POST", token: alice.accessToken, body: { name: "Стиральная машина", homeId: home.data.id } });
    const bill = await request<{ id: string }>(`${ws}/finance/obligations`, {
      method: "POST", token: alice.accessToken, body: { name: "Коммуналка", kind: "utility", payment: 650000, homeId: home.data.id }
    });
    for (const r of [task, list, thing, bill]) expect(r.status).toBe(201);
    // Not attached: another home's record never shows up here.
    await request(`${ws}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Без дома" } });

    // A home of another workspace cannot be used.
    const mix = await request(`${ws}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "x", homeId: foreignHome.data.id } });
    expect(mix.status).toBe(400);

    const overview = await request<Overview>(`${ws}/homes/${home.data.id}/overview`, { method: "GET", token: alice.accessToken });
    expect(overview.status).toBe(200);
    expect(overview.data.taskIds).toEqual([task.data.id]);
    expect(overview.data.listIds).toEqual([list.data.id]);
    expect(overview.data.inventoryIds).toEqual([thing.data.id]);
    expect(overview.data.obligationIds).toEqual([bill.data.id]);

    // A module the viewer cannot use contributes nothing (here: tasks switched off).
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: alice.workspaceId }, data: { disabledModules: ["tasks"] } }));
    const without = await request<Overview>(`${ws}/homes/${home.data.id}/overview`, { method: "GET", token: alice.accessToken });
    expect(without.data.taskIds).toEqual([]);
    expect(without.data.listIds).toEqual([list.data.id]);
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: alice.workspaceId }, data: { disabledModules: [] } }));

    // Nobody outside the workspace reads it.
    expect([403, 404]).toContain((await request(`${ws}/homes/${home.data.id}/overview`, { method: "GET", token: mallory.accessToken })).status);
  });

  it("привязать и отвязать существующее; удаление дома не удаляет дела и контакты, но убирает счётчики", async () => {
    const alice = await register("alice2");
    const ws = `/workspaces/${alice.workspaceId}`;
    const home = await request<{ id: string }>(`${ws}/homes`, { method: "POST", token: alice.accessToken, body: { name: "Дача", kind: "country" } });
    const other = await request<{ id: string }>(`${ws}/homes`, { method: "POST", token: alice.accessToken, body: { name: "Гараж" } });
    const task = await request<{ id: string }>(`${ws}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Закрыть воду" } });
    const base = `${ws}/homes/${home.data.id}`;

    expect((await request(`${base}/attach`, { method: "POST", token: alice.accessToken, body: { type: "task", id: task.data.id } })).status).toBe(204);
    expect((await request<Overview>(`${base}/overview`, { method: "GET", token: alice.accessToken })).data.taskIds).toEqual([task.data.id]);
    // Detaching from the wrong home does nothing to the record.
    expect((await request(`${ws}/homes/${other.data.id}/detach`, { method: "POST", token: alice.accessToken, body: { type: "task", id: task.data.id } })).status).toBe(404);
    expect((await request(`${base}/detach`, { method: "POST", token: alice.accessToken, body: { type: "task", id: task.data.id } })).status).toBe(204);
    expect((await request<Overview>(`${base}/overview`, { method: "GET", token: alice.accessToken })).data.taskIds).toEqual([]);

    await request(`${base}/attach`, { method: "POST", token: alice.accessToken, body: { type: "task", id: task.data.id } });
    await request(`${base}/meters`, { method: "POST", token: alice.accessToken, body: { name: "Свет", kind: "electricity" } });
    const contact = await request<{ id: string }>(`${base}/contacts`, { method: "POST", token: alice.accessToken, body: { name: "Сосед", role: "ключи от дачи" } });
    expect(contact.status).toBe(201);
    expect((await request(base, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
    // Since the «Контакты» module, a home's contacts outlive the home: only the link goes (SET NULL).
    const kept = await request<{ id: string; homeId: string | null; name: string }>(`${ws}/contacts/${contact.data.id}`, { method: "GET", token: alice.accessToken });
    expect(kept.status).toBe(200);
    expect(kept.data).toMatchObject({ homeId: null, name: "Сосед" });
    const tasks = await request<Array<{ id: string }>>(`${ws}/tasks`, { method: "GET", token: alice.accessToken });
    expect(tasks.data.map((t) => t.id)).toContain(task.data.id);
    expect(await prisma.asSystem((tx) => tx.meter.count({ where: { homeId: home.data.id } }))).toBe(0);
  });

  it("счётчики: единица по умолчанию, расход между показаниями, назад идти нельзя; контакты", async () => {
    const alice = await register("alice3");
    const ws = `/workspaces/${alice.workspaceId}`;
    const home = await request<{ id: string }>(`${ws}/homes`, { method: "POST", token: alice.accessToken, body: { name: "Квартира" } });
    const base = `${ws}/homes/${home.data.id}`;
    const meter = await request<{ id: string; unit: string }>(`${base}/meters`, { method: "POST", token: alice.accessToken, body: { name: "Холодная вода", kind: "water_cold" } });
    expect(meter.data.unit).toBe("м³");
    const readingsPath = `${base}/meters/${meter.data.id}/readings`;
    const day = (d: number) => new Date(2026, 9, d, 12).toISOString();

    expect((await request(readingsPath, { method: "POST", token: alice.accessToken, body: { value: 100, readAt: day(1) } })).status).toBe(201);
    expect((await request(readingsPath, { method: "POST", token: alice.accessToken, body: { value: 112.5, readAt: day(10) } })).status).toBe(201);
    const back = await request<{ message: string }>(readingsPath, { method: "POST", token: alice.accessToken, body: { value: 99, readAt: day(12) } });
    expect(back.status).toBe(400);
    expect(back.data.message).toContain("меньше предыдущего");
    expect((await request(readingsPath, { method: "POST", token: alice.accessToken, body: { value: -1 } })).status).toBe(400);

    const overview = await request<Overview>(`${base}/overview`, { method: "GET", token: alice.accessToken });
    const m = overview.data.meters[0];
    expect(m.lastValue).toBe(112.5);
    expect(m.readings.map((r) => r.consumption)).toEqual([12.5, null]);

    const afterDelete = await request<{ lastValue: number }>(`${readingsPath}/${m.readings[0].id}`, { method: "DELETE", token: alice.accessToken });
    expect(afterDelete.data.lastValue).toBe(100);

    const contact = await request<{ id: string }>(`${base}/contacts`, { method: "POST", token: alice.accessToken, body: { name: "ООО УК", role: "управляющая компания", phone: "+7 900 000-00-00" } });
    expect(contact.status).toBe(201);
    expect((await request(`${base}/contacts/${contact.data.id}`, { method: "PATCH", token: alice.accessToken, body: { phone: "+7 911 111-11-11" } })).status).toBe(200);
    expect((await request<Overview>(`${base}/overview`, { method: "GET", token: alice.accessToken })).data.contacts).toHaveLength(1);
    expect((await request(`${base}/contacts/${contact.data.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
  });

  it("«привязано к другому дому» не предлагается повторно, а лента дома собирает дела и показания", async () => {
    const alice = await register("alice4");
    const ws = `/workspaces/${alice.workspaceId}`;
    const flat = await request<{ id: string }>(`${ws}/homes`, { method: "POST", token: alice.accessToken, body: { name: "Квартира" } });
    const dacha = await request<{ id: string }>(`${ws}/homes`, { method: "POST", token: alice.accessToken, body: { name: "Дача" } });
    const task = await request<{ id: string }>(`${ws}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Побелить потолок", homeId: flat.data.id } });
    const free = await request<{ id: string }>(`${ws}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Свободная" } });

    const dachaView = await request<Overview>(`${ws}/homes/${dacha.data.id}/overview`, { method: "GET", token: alice.accessToken });
    expect(dachaView.data.elsewhere.taskIds).toContain(task.data.id);
    expect(dachaView.data.elsewhere.taskIds).not.toContain(free.data.id);
    const flatView = await request<Overview>(`${ws}/homes/${flat.data.id}/overview`, { method: "GET", token: alice.accessToken });
    expect(flatView.data.elsewhere.taskIds).not.toContain(task.data.id);

    await request(`${ws}/tasks/${task.data.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "done" } });
    await request(`${ws}/tasks/${task.data.id}/comments`, { method: "POST", token: alice.accessToken, body: { body: "готово" } });
    const meter = await request<{ id: string }>(`${ws}/homes/${flat.data.id}/meters`, { method: "POST", token: alice.accessToken, body: { name: "Газ", kind: "gas" } });
    await request(`${ws}/homes/${flat.data.id}/meters/${meter.data.id}/readings`, { method: "POST", token: alice.accessToken, body: { value: 55 } });
    // A chore of another home or of none does not leak into this feed.
    await request(`${ws}/tasks/${free.data.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "done" } });

    const feed = await request<Array<{ kind: string; summary: string; entity: { title: string } | null }>>(`${ws}/homes/${flat.data.id}/activity`, { method: "GET", token: alice.accessToken });
    expect(feed.status).toBe(200);
    expect(new Set(feed.data.map((e) => e.kind))).toEqual(new Set(["task_change", "task_comment", "meter_reading"]));
    expect(feed.data.every((e) => e.entity === null || e.entity.title === "Побелить потолок")).toBe(true);
    expect(feed.data.find((e) => e.kind === "meter_reading")?.summary).toContain("Газ");
    const otherFeed = await request<unknown[]>(`${ws}/homes/${dacha.data.id}/activity`, { method: "GET", token: alice.accessToken });
    expect(otherFeed.data).toEqual([]);
  });

  it("коммуналка: помесячные начисления, черновое копирование, тарифы и изоляция", async () => {
    const alice = await register("utilities-owner");
    const otherUser = await register("utilities-outsider");
    const ws = `/workspaces/${alice.workspaceId}`;
    const home = await request<{ id: string }>(`${ws}/homes`, { method: "POST", token: alice.accessToken, body: { name: "Квартира" } });
    const otherHome = await request<{ id: string }>(`${ws}/homes`, { method: "POST", token: alice.accessToken, body: { name: "Дача" } });
    const path = `${ws}/home-utilities/${home.data.id}`;
    const charge = { id: "00000000-0000-4000-8000-000000000001", name: "ТНС энерго", amountMinor: 112_341, confirmed: true, note: "" };
    const september = await request<{ revision: number; grandTotalMinor: number; confirmedTotalMinor: number }>(`${path}/months/2026-09`, {
      method: "PUT", token: alice.accessToken, body: { rentMinor: 1_800_000, rentConfirmed: true, charges: [charge] }
    });
    expect(september.status).toBe(200);
    expect(september.data.grandTotalMinor).toBe(1_912_341);
    expect(september.data.confirmedTotalMinor).toBe(1_912_341);
    expect((await request(`${path}/months/2026-09`, { method: "PUT", token: alice.accessToken, body: { rentMinor: 1_700_000, rentConfirmed: true, charges: [charge] } })).status).toBe(409);
    const revised = await request<{ revision: number }>(`${path}/months/2026-09`, { method: "PUT", token: alice.accessToken, body: { expectedRevision: september.data.revision, rentMinor: 1_800_000, rentConfirmed: true, charges: [charge] } });
    expect(revised.status).toBe(200);
    expect(revised.data.revision).toBe(september.data.revision + 1);

    const october = await request<{ rentConfirmed: boolean; charges: Array<{ confirmed: boolean; amountMinor: number }> }>(`${path}/months/2026-10/copy-previous`, { method: "POST", token: alice.accessToken });
    expect(october.status).toBe(201);
    expect(october.data.rentConfirmed).toBe(false);
    expect(october.data.charges).toMatchObject([{ amountMinor: 112_341, confirmed: false }]);
    expect((await request(`${path}/months/2026-10/copy-previous`, { method: "POST", token: alice.accessToken })).status).toBe(409);
    expect((await request(`${ws}/home-utilities/${otherHome.data.id}/months`, { method: "GET", token: alice.accessToken })).data).toEqual([]);
    expect([403, 404]).toContain((await request(`${path}/months`, { method: "GET", token: otherUser.accessToken })).status);

    const meter = await request<{ id: string }>(`${ws}/homes/${home.data.id}/meters`, { method: "POST", token: alice.accessToken, body: { name: "Свет", kind: "electricity" } });
    const tariffPath = `${path}/meters/${meter.data.id}/tariffs`;
    const tariff = await request<{ rateRub: string }>(tariffPath, { method: "POST", token: alice.accessToken, body: { effectiveFrom: "2026-10-01", rateRub: "6.25", note: "" } });
    expect(tariff.status).toBe(201);
    expect(tariff.data.rateRub).toBe("6.2500");
    expect((await request(tariffPath, { method: "GET", token: alice.accessToken })).status).toBe(200);

    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: alice.workspaceId }, data: { pluginOverrides: ["home-utilities"] } }));
    expect([403, 404, 409]).toContain((await request(`${path}/months`, { method: "GET", token: alice.accessToken })).status);
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: alice.workspaceId }, data: { pluginOverrides: [] } }));
    expect((await request<Array<{ period: string }>>(`${path}/months`, { method: "GET", token: alice.accessToken })).data.map((m) => m.period)).toEqual(["2026-10", "2026-09"]);
  });

  it("перенос таблицы сохраняет исходные итоги, а оплата ссылается на расход без второго списания", async () => {
    const alice = await register("utility-import-payment");
    const outsider = await register("utility-payment-outsider");
    const ws = `/workspaces/${alice.workspaceId}`;
    const home = await request<{ id: string }>(`${ws}/homes`, { method: "POST", token: alice.accessToken, body: { name: "Квартира" } });
    const path = `${ws}/home-utilities/${home.data.id}`;
    const charge = { id: "00000000-0000-4000-8000-000000000123", name: "ТНС энерго", amountMinor: 106704, confirmed: false, note: "" };
    const importBody = { rows: [{ period: "2026-08", rentMinor: 1800000, charges: [charge], importedUtilityMinor: 106704, importedGrandTotalMinor: 1906705 }] };
    const preview = await request<{ dryRun: boolean; rows: Array<{ grandDifferenceMinor: number }> }>(`${path}/months/import`, { method: "POST", token: alice.accessToken, body: { ...importBody, dryRun: true } });
    expect(preview.status).toBe(201);
    expect(preview.data.rows[0].grandDifferenceMinor).toBe(-1);
    expect((await request<unknown[]>(`${path}/months`, { method: "GET", token: alice.accessToken })).data).toEqual([]);
    const imported = await request<{ imported: number; skipped: number }>(`${path}/months/import`, { method: "POST", token: alice.accessToken, body: { ...importBody, dryRun: false } });
    expect(imported.data).toMatchObject({ imported: 1, skipped: 0 });
    expect((await request<{ imported: number; skipped: number }>(`${path}/months/import`, { method: "POST", token: alice.accessToken, body: { ...importBody, dryRun: false } })).data).toMatchObject({ imported: 0, skipped: 1 });
    const month = (await request<Array<{ revision: number; importedGrandTotalMinor: number; confirmedTotalMinor: number }>>(`${path}/months`, { method: "GET", token: alice.accessToken })).data[0];
    expect(month).toMatchObject({ importedGrandTotalMinor: 1906705, confirmedTotalMinor: 0 });

    const account = await request<{ id: string }>(`${ws}/finance/accounts`, { method: "POST", token: alice.accessToken, body: { name: "Карта", kind: "card", currency: "RUB", startingBalance: 0 } });
    const category = await request<{ id: string }>(`${ws}/finance/categories`, { method: "POST", token: alice.accessToken, body: { name: "Коммуналка", kind: "expense" } });
    const expense = await request<{ id: string }>(`${ws}/finance/transactions`, { method: "POST", token: alice.accessToken, body: { accountId: account.data.id, type: "expense", note: "Счета за август", occurredAt: "2026-08-30T12:00:00.000Z", lines: [{ categoryId: category.data.id, amount: 1_906_704 }] } });
    expect(expense.status).toBe(201);
    expect((await request(`${path}/months/2026-08/payments`, { method: "PUT", token: alice.accessToken, body: { transactionId: expense.data.id, amountMinor: 1_906_704 } })).status).toBe(409);
    const confirmed = await request<{ revision: number; confirmedTotalMinor: number }>(`${path}/months/2026-08`, { method: "PUT", token: alice.accessToken, body: { expectedRevision: month.revision, rentMinor: 1_800_000, rentConfirmed: true, charges: [{ ...charge, confirmed: true }] } });
    expect(confirmed.data.confirmedTotalMinor).toBe(1_906_704);
    const linked = await request<{ paidMinor: number; remainingMinor: number; payments: Array<{ id: string; valid: boolean }> }>(`${path}/months/2026-08/payments`, { method: "PUT", token: alice.accessToken, body: { transactionId: expense.data.id, amountMinor: 1_906_704 } });
    expect(linked.status).toBe(200);
    expect(linked.data).toMatchObject({ paidMinor: 1_906_704, remainingMinor: 0 });
    expect(linked.data.payments[0].valid).toBe(true);
    expect((await request(`${path}/months/2026-08/payments`, { method: "PUT", token: outsider.accessToken, body: { transactionId: expense.data.id, amountMinor: 100 } })).status).toBeGreaterThanOrEqual(403);
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: alice.workspaceId }, data: { disabledModules: ["finance"] } }));
    const hiddenFinance = (await request<Array<{ paidMinor: number | null; payments: unknown[] }>>(`${path}/months`, { method: "GET", token: alice.accessToken })).data[0];
    expect(hiddenFinance).toMatchObject({ paidMinor: null, payments: [] });
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: alice.workspaceId }, data: { disabledModules: [] } }));
    const changed = await request(`${ws}/finance/transactions/${expense.data.id}`, { method: "PATCH", token: alice.accessToken, body: { lines: [{ categoryId: category.data.id, amount: 1_000_000 }] } });
    expect(changed.status).toBe(200);
    const invalid = (await request<Array<{ paidMinor: number; payments: Array<{ valid: boolean }> }>>(`${path}/months`, { method: "GET", token: alice.accessToken })).data[0];
    expect(invalid).toMatchObject({ paidMinor: 0 });
    expect(invalid.payments[0].valid).toBe(false);
    expect((await request<Array<{ id: string }>>(`${ws}/finance/transactions`, { method: "GET", token: alice.accessToken })).data.filter((row) => row.id === expense.data.id)).toHaveLength(1);
    expect((await request<{ paidMinor: number }>(`${path}/months/2026-08/payments/${linked.data.payments[0].id}`, { method: "DELETE", token: alice.accessToken })).data.paidMinor).toBe(0);
  });

  async function register(name: string): Promise<RegisteredSession> {
    const email = `${emailPrefix}-${name}@example.test`;
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    expect(workspaces.status).toBe(200);
    return { accessToken: response.data.accessToken, user: { ...response.data.user, name }, email, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(
    path: string,
    options: { method: string; token?: string; body?: unknown }
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }
});

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/** Plugin `finance-transfer-match`: an expense + an income that are one transfer become ONE transfer, atomically. */
describe("Finance transfer match", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `finance-transfer-match-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
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
    const registered = await request<{ accessToken: string }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(registered.status).toBe(201);
    const token = registered.data.accessToken;
    const workspaceId = (await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token })).data[0]!.id;
    const base = `/workspaces/${workspaceId}/finance`;
    const account = async (accountName: string) => (await request<{ id: string }>(`${base}/accounts`, { method: "POST", token, body: { name: accountName, startingBalance: 100000 } })).data.id;
    return { token, base, a: await account("Карта"), b: await account("Накопительный") };
  }

  type Row = { ref: string; type: "expense" | "income"; amount: number; occurredAt: string; note: string; tags: string[] };
  const importInto = (ctx: { token: string; base: string }, accountId: string, rows: Row[]) =>
    request<{ imported: number; duplicates: number }>(`${ctx.base}/transactions/import`, { method: "POST", token: ctx.token, body: { accountId, rows, dryRun: false } });

  it("merges a pair into one transfer, keeps both balances right, and an import of the same files does not bring the rows back", async () => {
    const ctx = await setup("merge");
    const out: Row = { ref: "bank-a:1", type: "expense", amount: 50000, occurredAt: "2026-10-01T10:00:00.000Z", note: "Перевод на накопительный", tags: [] };
    const inn: Row = { ref: "bank-b:9", type: "income", amount: 50000, occurredAt: "2026-10-02T09:00:00.000Z", note: "Поступление", tags: [] };
    expect((await importInto(ctx, ctx.a, [out])).data.imported).toBe(1);
    expect((await importInto(ctx, ctx.b, [inn])).data.imported).toBe(1);

    const all = (await request<{ id: string; type: string }[]>(`${ctx.base}/transactions`, { method: "GET", token: ctx.token })).data;
    const expenseId = all.find((t) => t.type === "expense")!.id;
    const incomeId = all.find((t) => t.type === "income")!.id;
    const merged = await request<{ type: string; accountId: string; toAccountId: string; totalAmount: number; importedRef: string }>(`${ctx.base}/transfer-match/merge`, {
      method: "POST", token: ctx.token, body: { expenseId, incomeId }
    });
    expect(merged.status).toBe(201);
    expect(merged.data).toMatchObject({ type: "transfer", accountId: ctx.a, toAccountId: ctx.b, totalAmount: 50000, importedRef: "bank-a:1" });

    const after = (await request<{ type: string }[]>(`${ctx.base}/transactions`, { method: "GET", token: ctx.token })).data;
    expect(after.map((t) => t.type)).toEqual(["transfer"]);
    const balances = (await request<{ id: string; balance: number }[]>(`${ctx.base}/accounts`, { method: "GET", token: ctx.token })).data;
    expect(balances.find((x) => x.id === ctx.a)!.balance).toBe(50000);
    expect(balances.find((x) => x.id === ctx.b)!.balance).toBe(150000);

    // The same statements imported again: both rows are recognised as already handled.
    expect((await importInto(ctx, ctx.a, [out])).data).toMatchObject({ imported: 0, duplicates: 1 });
    expect((await importInto(ctx, ctx.b, [inn])).data).toMatchObject({ imported: 0, duplicates: 1 });
  });

  it("refuses what is not a transfer pair, and a pair can be merged only once", async () => {
    const ctx = await setup("refuse");
    const at = "2026-10-01T10:00:00.000Z";
    const post = (body: object) => request<{ id: string }>(`${ctx.base}/transactions`, { method: "POST", token: ctx.token, body: { occurredAt: at, note: "", lines: [{ categoryId: null, amount: 700 }], ...body } });
    const expense = (await post({ accountId: ctx.a, type: "expense" })).data.id;
    const other = (await post({ accountId: ctx.b, type: "income", lines: [{ categoryId: null, amount: 701 }] })).data.id;
    const good = (await post({ accountId: ctx.b, type: "income" })).data.id;

    expect((await request(`${ctx.base}/transfer-match/merge`, { method: "POST", token: ctx.token, body: { expenseId: expense, incomeId: other } })).status).toBe(409);
    expect((await request(`${ctx.base}/transfer-match/merge`, { method: "POST", token: ctx.token, body: { expenseId: expense, incomeId: good } })).status).toBe(201);
    expect((await request(`${ctx.base}/transfer-match/merge`, { method: "POST", token: ctx.token, body: { expenseId: expense, incomeId: good } })).status).toBe(404);
  });

  it("is switched off with the plugin, and a foreign workspace's rows are not found", async () => {
    const one = await setup("gate-one");
    const two = await setup("gate-two");
    const at = "2026-10-01T10:00:00.000Z";
    const mk = async (ctx: typeof one, accountId: string, type: string) =>
      (await request<{ id: string }>(`${ctx.base}/transactions`, { method: "POST", token: ctx.token, body: { accountId, type, occurredAt: at, note: "", lines: [{ categoryId: null, amount: 900 }] } })).data.id;
    const e = await mk(one, one.a, "expense");
    const i = await mk(two, two.b, "income");
    expect((await request(`${one.base}/transfer-match/merge`, { method: "POST", token: one.token, body: { expenseId: e, incomeId: i } })).status).toBe(404);

    const workspaceId = one.base.split("/")[2];
    await request(`/workspaces/${workspaceId}/plugins/finance-transfer-match`, { method: "PATCH", token: one.token, body: { enabled: false } });
    expect((await request(`${one.base}/transfer-match/merge`, { method: "POST", token: one.token, body: { expenseId: e, incomeId: i } })).status).toBe(409);
  });
});

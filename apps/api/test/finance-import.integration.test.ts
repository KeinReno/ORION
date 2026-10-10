import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Import of operations from a file: one atomic batch into one account. A dry run reports exactly what a real
 * run would do and writes nothing; `ref` makes a repeated file a no-op; a category of the wrong kind or from
 * another workspace refuses that row; another workspace's account is refused outright.
 */
describe("Finance import (CSV batches)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `finance-import-${runId}`;

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

  async function register(name: string) {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { ...response.data, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  type Result = { dryRun: boolean; imported: number; duplicates: number; errors: { line: number; reason: string }[]; incomeTotal: number; expenseTotal: number };
  type Tx = { id: string; importedRef: string | null; type: string; totalAmount: number };

  async function setup(name: string) {
    const alice = await register(name);
    const base = `/workspaces/${alice.workspaceId}/finance`;
    const account = await request<{ id: string }>(`${base}/accounts`, { method: "POST", token: alice.accessToken, body: { name: "Карта", startingBalance: 0 } });
    const food = await request<{ id: string }>(`${base}/categories`, { method: "POST", token: alice.accessToken, body: { name: "Продукты", kind: "expense" } });
    const pay = await request<{ id: string }>(`${base}/categories`, { method: "POST", token: alice.accessToken, body: { name: "Зарплата", kind: "income" } });
    return { alice, base, accountId: account.data.id, foodId: food.data.id, payId: pay.data.id };
  }

  const row = (ref: string, over: Record<string, unknown> = {}) => ({ ref, occurredAt: "2026-03-05T09:00:00.000Z", type: "expense", amount: 50000, note: "Хлеб", ...over });

  it("a dry run writes nothing; the real run writes the same; the same file again is all duplicates", async () => {
    const { alice, base, accountId, foodId, payId } = await setup("flow");
    const rows = [row("r1", { categoryId: foodId }), row("r2", { type: "income", amount: 8000000, note: "Аванс", categoryId: payId })];

    const dry = await request<Result>(`${base}/transactions/import`, { method: "POST", token: alice.accessToken, body: { accountId, rows } });
    expect(dry.status).toBe(201);
    expect(dry.data).toMatchObject({ dryRun: true, imported: 2, duplicates: 0, errors: [], incomeTotal: 8000000, expenseTotal: 50000 });
    expect((await request<Tx[]>(`${base}/transactions`, { method: "GET", token: alice.accessToken })).data).toHaveLength(0);

    const real = await request<Result>(`${base}/transactions/import`, { method: "POST", token: alice.accessToken, body: { accountId, rows, dryRun: false } });
    expect(real.data).toMatchObject({ dryRun: false, imported: 2, duplicates: 0 });
    const list = await request<Tx[]>(`${base}/transactions`, { method: "GET", token: alice.accessToken });
    expect(list.data.map((t) => t.importedRef).sort()).toEqual(["r1", "r2"]);
    const balance = (await request<{ id: string; balance: number }[]>(`${base}/accounts`, { method: "GET", token: alice.accessToken })).data.find((a) => a.id === accountId)!.balance;
    expect(balance).toBe(8000000 - 50000);

    const again = await request<Result>(`${base}/transactions/import`, { method: "POST", token: alice.accessToken, body: { accountId, rows, dryRun: false } });
    expect(again.data).toMatchObject({ imported: 0, duplicates: 2 });
    expect((await request<Tx[]>(`${base}/transactions`, { method: "GET", token: alice.accessToken })).data).toHaveLength(2);
  });

  it("repeats inside one request count as duplicates, and refused rows do not block the others", async () => {
    const { alice, base, accountId, foodId, payId } = await setup("mixed");
    const result = await request<Result>(`${base}/transactions/import`, {
      method: "POST",
      token: alice.accessToken,
      body: {
        accountId,
        dryRun: false,
        rows: [
          row("a", { categoryId: foodId }),
          row("a", { categoryId: foodId }), // same ref twice
          row("b", { categoryId: payId }), // an income category on an expense row
          row("c", { categoryId: "no-such-category" }),
          row("d")
        ]
      }
    });
    expect(result.data.imported).toBe(2);
    expect(result.data.duplicates).toBe(1);
    expect(result.data.errors.map((e) => e.line)).toEqual([3, 4]);
    expect((await request<Tx[]>(`${base}/transactions`, { method: "GET", token: alice.accessToken })).data.map((t) => t.importedRef).sort()).toEqual(["a", "d"]);
  });

  it("refuses another workspace's account and category, and a non-member", async () => {
    const one = await setup("owner");
    const other = await setup("stranger");
    // The stranger's account in the owner's workspace.
    const crossAccount = await request(`${one.base}/transactions/import`, { method: "POST", token: one.alice.accessToken, body: { accountId: other.accountId, rows: [row("x")] } });
    expect(crossAccount.status).toBe(400);
    // The stranger's category.
    const crossCategory = await request<Result>(`${one.base}/transactions/import`, { method: "POST", token: one.alice.accessToken, body: { accountId: one.accountId, rows: [row("y", { categoryId: other.foodId })] } });
    expect(crossCategory.data.errors).toHaveLength(1);
    expect(crossCategory.data.imported).toBe(0);
    // Not a member of the owner's workspace at all.
    const outsider = await request(`${one.base}/transactions/import`, { method: "POST", token: other.alice.accessToken, body: { accountId: one.accountId, rows: [row("z")] } });
    expect(outsider.status).toBe(403);
  });

  it("validates the payload: no rows, a negative or fractional amount, too many rows", async () => {
    const { alice, base, accountId } = await setup("shape");
    const post = (rows: unknown[]) => request(`${base}/transactions/import`, { method: "POST", token: alice.accessToken, body: { accountId, rows } });
    expect((await post([])).status).toBe(400);
    expect((await post([row("n", { amount: -5 })])).status).toBe(400);
    expect((await post([row("f", { amount: 1.5 })])).status).toBe(400);
    expect((await post([row("t", { type: "transfer" })])).status).toBe(400);
    expect((await post(Array.from({ length: 2001 }, (_, i) => row(`m${i}`)))).status).toBe(400);
    // The largest allowed batch must fit the request body limit.
    const max = await request<Result>(`${base}/transactions/import`, { method: "POST", token: alice.accessToken, body: { accountId, rows: Array.from({ length: 2000 }, (_, i) => row(`ok${i}`)) } });
    expect(max.status).toBe(201);
    expect(max.data.imported).toBe(2000);
  });
});

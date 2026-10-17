import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface RegisteredSession {
  accessToken: string;
  user: { id: string };
  workspaceId: string;
}

describe("finance: reports and budgets never add different currencies together", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `fin-currency-${runId}`;

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
        const users = await tx.user.findMany({
          where: { email: { startsWith: emailPrefix } },
          select: { id: true }
        });
        if (users.length === 0) return;
        const userIds = users.map((user) => user.id);
        const memberships = await tx.workspaceMember.findMany({
          where: { userId: { in: userIds } },
          select: { workspaceId: true }
        });
        const workspaceIds = [...new Set(memberships.map((membership) => membership.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
  });

  async function register(name: string): Promise<RegisteredSession> {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", {
      method: "GET",
      token: response.data.accessToken
    });
    expect(workspaces.status).toBe(200);
    expect(workspaces.data).toHaveLength(1);
    return { ...response.data, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(
    path: string,
    options: { method: string; token?: string; body?: unknown }
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }

  it("splits monthly summary, category breakdown and budget spent by account currency", async () => {
    const s = await register("owner");
    const base = `/workspaces/${s.workspaceId}/finance`;
    const post = async <T,>(path: string, body: unknown): Promise<T> => {
      const res = await request<T>(`${base}${path}`, { method: "POST", token: s.accessToken, body });
      expect(res.status, JSON.stringify(res.data)).toBe(201);
      return res.data;
    };

    const rub = await post<{ id: string }>("/accounts", { name: "Карта", currency: "RUB", startingBalance: 100_000 });
    const usd = await post<{ id: string }>("/accounts", { name: "USD", currency: "USD", startingBalance: 5_000 });
    const food = await post<{ id: string }>("/categories", { name: "Еда", kind: "expense" });

    const month = new Date().toISOString().slice(0, 7);
    const occurredAt = new Date().toISOString();
    await post("/transactions", { accountId: rub.id, type: "expense", occurredAt, lines: [{ categoryId: food.id, amount: 30_000 }] });
    await post("/transactions", { accountId: usd.id, type: "expense", occurredAt, lines: [{ categoryId: food.id, amount: 2_000 }] });
    await post("/transactions", { accountId: usd.id, type: "income", occurredAt, lines: [{ amount: 1_000 }] });
    // A transfer across currencies moves money between the series (balances move it as is), never into income/expense.
    await post("/transactions", { accountId: rub.id, toAccountId: usd.id, type: "transfer", occurredAt, lines: [{ categoryId: null, amount: 500 }] });

    const monthly = await request<Array<{ month: string; currency: string; income: number; expense: number; netWorth: number }>>(
      `${base}/reports/monthly?months=1`,
      { method: "GET", token: s.accessToken }
    );
    expect(monthly.status).toBe(200);
    expect(monthly.data).toEqual([
      { month, currency: "RUB", income: 0, expense: 30_000, netWorth: 69_500 },
      { month, currency: "USD", income: 1_000, expense: 2_000, netWorth: 4_500 }
    ]);
    const accounts = await request<Array<{ currency: string; balance: number }>>(`${base}/accounts`, { method: "GET", token: s.accessToken });
    expect(Object.fromEntries(accounts.data.map((a) => [a.currency, a.balance]))).toEqual({ RUB: 69_500, USD: 4_500 });

    const breakdown = await request<Array<{ categoryId: string | null; currency: string; amount: number }>>(
      `${base}/reports/categories?month=${month}`,
      { method: "GET", token: s.accessToken }
    );
    expect(breakdown.status).toBe(200);
    expect(breakdown.data.map((e) => [e.categoryId, e.currency, e.amount])).toEqual([
      [food.id, "RUB", 30_000],
      [food.id, "USD", 2_000]
    ]);

    // Same category, same month, two currencies — two independent budgets.
    const monthIso = `${month}-01T00:00:00.000Z`;
    const rubBudget = await post<{ currency: string; spent: number }>("/budgets", {
      categoryId: food.id,
      month: monthIso,
      limitAmount: 50_000,
      currency: "RUB"
    });
    expect(rubBudget.currency).toBe("RUB");
    await post("/budgets", { categoryId: food.id, month: monthIso, limitAmount: 1_000, currency: "USD" });
    const duplicate = await request(`${base}/budgets`, {
      method: "POST",
      token: s.accessToken,
      body: { categoryId: food.id, month: monthIso, limitAmount: 1, currency: "USD" }
    });
    expect(duplicate.status).toBe(409);

    const budgets = await request<Array<{ currency: string; spent: number; limitAmount: number }>>(`${base}/budgets?month=${month}`, {
      method: "GET",
      token: s.accessToken
    });
    expect(budgets.status).toBe(200);
    const byCurrency = Object.fromEntries(budgets.data.map((b) => [b.currency, b]));
    // Before the fix both budgets reported spent = 32 000 (RUB + USD kopecks).
    expect(byCurrency.RUB.spent).toBe(30_000);
    expect(byCurrency.USD.spent).toBe(2_000);
  });

  it("keeps a single-currency workspace at one row per month", async () => {
    const s = await register("solo");
    const res = await request<Array<{ currency: string }>>(`/workspaces/${s.workspaceId}/finance/reports/monthly?months=3`, {
      method: "GET",
      token: s.accessToken
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveLength(3);
    expect(new Set(res.data.map((r) => r.currency))).toEqual(new Set(["RUB"]));
  });

  it("rolls over only from the previous month's budget of the same category and currency", async () => {
    const s = await register("rollover");
    const base = `/workspaces/${s.workspaceId}/finance`;
    const post = async <T,>(path: string, body: unknown): Promise<T> => {
      const res = await request<T>(`${base}${path}`, { method: "POST", token: s.accessToken, body });
      expect(res.status, JSON.stringify(res.data)).toBe(201);
      return res.data;
    };
    const rub = await post<{ id: string }>("/accounts", { name: "Карта", currency: "RUB", startingBalance: 0 });
    const usd = await post<{ id: string }>("/accounts", { name: "USD", currency: "USD", startingBalance: 0 });
    const food = await post<{ id: string }>("/categories", { name: "Еда", kind: "expense" });

    const now = new Date();
    const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const previousMid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12)).toISOString();

    // Last month: RUB limit 500.00, nothing spent in RUB; USD limit 10.00, 4.00 spent in USD.
    await post("/budgets", { categoryId: food.id, month: previous.toISOString(), limitAmount: 50_000, currency: "RUB" });
    await post("/budgets", { categoryId: food.id, month: previous.toISOString(), limitAmount: 1_000, currency: "USD" });
    await post("/transactions", { accountId: usd.id, type: "expense", occurredAt: previousMid, lines: [{ categoryId: food.id, amount: 400 }] });
    // A RUB expense last month in ANOTHER account currency must not eat the USD leftover either.
    await post("/transactions", { accountId: rub.id, type: "expense", occurredAt: previousMid, lines: [{ categoryId: food.id, amount: 10_000 }] });

    await post("/budgets", { categoryId: food.id, month: current.toISOString(), limitAmount: 30_000, currency: "RUB", rollover: true });
    await post("/budgets", { categoryId: food.id, month: current.toISOString(), limitAmount: 1_000, currency: "USD", rollover: true });

    const month = current.toISOString().slice(0, 7);
    const budgets = await request<Array<{ currency: string; carryOver: number }>>(`${base}/budgets?month=${month}`, { method: "GET", token: s.accessToken });
    expect(budgets.status).toBe(200);
    const carry = Object.fromEntries(budgets.data.map((b) => [b.currency, b.carryOver]));
    expect(carry).toEqual({ RUB: 40_000, USD: 600 });
  });

  it("defaults a new budget to the workspace's own currency, not a blind RUB", async () => {
    const s = await register("usd-only");
    const base = `/workspaces/${s.workspaceId}/finance`;
    const account = await request(`${base}/accounts`, { method: "POST", token: s.accessToken, body: { name: "Card", currency: "USD", startingBalance: 0 } });
    expect(account.status).toBe(201);
    const category = await request<{ id: string }>(`${base}/categories`, { method: "POST", token: s.accessToken, body: { name: "Food", kind: "expense" } });
    const month = `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;
    const budget = await request<{ currency: string }>(`${base}/budgets`, {
      method: "POST",
      token: s.accessToken,
      body: { categoryId: category.data.id, month, limitAmount: 10_000 }
    });
    expect(budget.status).toBe(201);
    expect(budget.data.currency).toBe("USD");
  });

  it("reports project costs per currency instead of one mixed sum", async () => {
    const s = await register("project");
    const base = `/workspaces/${s.workspaceId}/finance`;
    const post = async <T,>(path: string, body: unknown): Promise<T> => {
      const res = await request<T>(path, { method: "POST", token: s.accessToken, body });
      expect(res.status, JSON.stringify(res.data)).toBe(201);
      return res.data;
    };
    const project = await post<{ id: string }>(`/workspaces/${s.workspaceId}/projects`, { name: "Поездка" });
    const rub = await post<{ id: string }>(`${base}/accounts`, { name: "Карта", currency: "RUB", startingBalance: 0 });
    const usd = await post<{ id: string }>(`${base}/accounts`, { name: "USD", currency: "USD", startingBalance: 0 });
    const hotel = await post<{ id: string }>(`${base}/categories`, { name: "Отель", kind: "expense" });
    const occurredAt = new Date().toISOString();
    const expense = (accountId: string, amount: number) =>
      post(`${base}/transactions`, { accountId, type: "expense", occurredAt, projectId: project.id, lines: [{ categoryId: hotel.id, amount }] });
    await expense(usd.id, 2_000);
    await expense(usd.id, 3_000);
    await expense(rub.id, 30_000);

    const costs = await request<{
      currency: string | null;
      expense: number;
      operationCount: number;
      mixedCurrencies: boolean;
      byCurrency: Array<{ currency: string; income: number; expense: number; operationCount: number }>;
      expenseByCategory: Array<{ currency: string; amount: number }>;
    }>(`${base}/projects/${project.id}/costs`, { method: "GET", token: s.accessToken });
    expect(costs.status).toBe(200);
    // The project's own currency (Project.currency defaults to RUB) leads; before the fix expense was 35 000 of nothing.
    expect(costs.data.currency).toBe("RUB");
    expect(costs.data.expense).toBe(30_000);
    expect(costs.data.operationCount).toBe(3);
    expect(costs.data.mixedCurrencies).toBe(true);
    expect(costs.data.byCurrency).toEqual([
      { currency: "RUB", income: 0, expense: 30_000, operationCount: 1 },
      { currency: "USD", income: 0, expense: 5_000, operationCount: 2 }
    ]);
    expect(costs.data.expenseByCategory.map((e) => [e.currency, e.amount])).toEqual([
      ["RUB", 30_000],
      ["USD", 5_000]
    ]);
  });
});

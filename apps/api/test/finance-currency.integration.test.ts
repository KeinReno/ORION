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

    const monthly = await request<Array<{ month: string; currency: string; income: number; expense: number; netWorth: number }>>(
      `${base}/reports/monthly?months=1`,
      { method: "GET", token: s.accessToken }
    );
    expect(monthly.status).toBe(200);
    expect(monthly.data).toEqual([
      { month, currency: "RUB", income: 0, expense: 30_000, netWorth: 70_000 },
      { month, currency: "USD", income: 1_000, expense: 2_000, netWorth: 4_000 }
    ]);

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
});

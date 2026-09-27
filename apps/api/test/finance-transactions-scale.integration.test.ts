import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * S15 — добивка хвостов: подтверждает или опровергает классификацию
 * "finance-сервисы — маленькие справочники, класса бага Time/Inbox тут нет"
 * из 12-PROGRESS.md записи S15, конкретно для `Transaction` (в отличие от
 * реально маленьких Account/Category).
 *
 * Проверяемая гипотеза: `TransactionsService.list` уже пагинирован
 * (`take: limit ?? 50, skip: offset`, см. transactions.service.ts) и
 * `ReportsService.monthlySummary`/`categoryBreakdown` считают через
 * `prisma.aggregate`/`groupBy` в БД, а не суммированием одной подгруженной
 * страницы — значит с ростом до 500+ операций (реалистично для
 * многолетнего command-сценария) список не отдаётся целиком необрезанным
 * запросом и не тихо усекается с неверным "Всего" (в отличие от бага,
 * который был у Time до основной S15-сессии).
 *
 * Bulk-insert напрямую через Prisma (не 600 отдельных API-вызовов), как в
 * эталоне time-pagination.integration.test.ts.
 */
interface RegisteredSession {
  accessToken: string;
  user: { id: string };
  workspaceId: string;
}

describe("S15 (добивка): finance transactions at scale — pagination + exact server-side totals", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `s15-fin-${runId}`;

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

  /** Bulk-inserts `count` expense transactions of exactly `amountEach` kopecks, directly via Prisma. */
  async function seedTransactions(
    workspaceId: string,
    accountId: string,
    count: number,
    amountEach: number,
    startAt: Date,
    stepMs: number
  ): Promise<void> {
    await prisma.asSystem(async (tx) => {
      for (let i = 0; i < count; i++) {
        const occurredAt = new Date(startAt.getTime() + i * stepMs);
        await tx.transaction.create({
          data: {
            workspaceId,
            accountId,
            type: "expense",
            note: `bulk-${i}`,
            occurredAt,
            lines: { create: [{ workspaceId, amount: amountEach }] }
          }
        });
      }
    });
  }

  it("list() is already offset-paginated (default page < total) for a 600-row workspace", async () => {
    const alice = await register("alice-list");
    const account = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/finance/accounts`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Card", kind: "card", currency: "RUB", startingBalance: 0 }
    });
    expect(account.status).toBe(201);

    const COUNT = 600;
    const AMOUNT = 12_345;
    const start = new Date("2020-01-01T00:00:00.000Z");
    await seedTransactions(alice.workspaceId, account.data.id, COUNT, AMOUNT, start, 3_600_000);

    // Default page: not the full 600 (confirms bounded `take`, not an
    // unbounded `findMany` that would return everything in one response).
    const firstPage = await request<Array<{ id: string }>>(
      `/workspaces/${alice.workspaceId}/finance/transactions?from=2020-01-01T00:00:00.000Z&to=2021-01-01T00:00:00.000Z`,
      { method: "GET", token: alice.accessToken }
    );
    expect(firstPage.status).toBe(200);
    expect(firstPage.data.length).toBeLessThan(COUNT);
    expect(firstPage.data.length).toBe(50); // documented DEFAULT_PAGE_SIZE in transactions.service.ts

    // Offset paging reaches every row with no duplicates and no gaps —
    // proves the truncation is a real page boundary, not a silent drop.
    const seenIds = new Set<string>();
    let offset = 0;
    let guard = 0;
    for (;;) {
      const page = await request<Array<{ id: string }>>(
        `/workspaces/${alice.workspaceId}/finance/transactions?from=2020-01-01T00:00:00.000Z&to=2021-01-01T00:00:00.000Z&limit=100&offset=${offset}`,
        { method: "GET", token: alice.accessToken }
      );
      expect(page.status).toBe(200);
      if (page.data.length === 0) break;
      for (const item of page.data) {
        expect(seenIds.has(item.id)).toBe(false);
        seenIds.add(item.id);
      }
      offset += 100;
      guard += 1;
      expect(guard).toBeLessThan(50); // sanity bound against an infinite loop
    }
    expect(seenIds.size).toBe(COUNT);
  });

  it("monthlySummary/categoryBreakdown are exact server-side aggregates, not a page sum, for >500 rows", async () => {
    const bob = await register("bob-report");
    const account = await request<{ id: string }>(`/workspaces/${bob.workspaceId}/finance/accounts`, {
      method: "POST",
      token: bob.accessToken,
      body: { name: "Card", kind: "card", currency: "RUB", startingBalance: 0 }
    });
    expect(account.status).toBe(201);

    const COUNT = 550; // > 500, and well past the 50-row default list page
    const AMOUNT = 1_000;
    // `ReportsService.monthlySummary` only ever buckets by the *current*
    // real-world month (no arbitrary month query) — seed a tight cluster
    // "now" (1s apart, ~9 minutes total span) so every row lands in the
    // current month bucket regardless of when in the month this runs.
    const now = new Date();
    const start = new Date(now.getTime() - COUNT * 1000);
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    await seedTransactions(bob.workspaceId, account.data.id, COUNT, AMOUNT, start, 1000);

    const summary = await request<Array<{ month: string; expense: number }>>(
      `/workspaces/${bob.workspaceId}/finance/reports/monthly?months=1`,
      { method: "GET", token: bob.accessToken }
    );
    expect(summary.status).toBe(200);
    const currentEntry = summary.data.find((m) => m.month === monthKey);
    expect(currentEntry?.expense).toBe(COUNT * AMOUNT);

    const breakdown = await request<Array<{ amount: number }>>(
      `/workspaces/${bob.workspaceId}/finance/reports/categories?month=${monthKey}`,
      { method: "GET", token: bob.accessToken }
    );
    expect(breakdown.status).toBe(200);
    const totalBreakdown = breakdown.data.reduce((sum, entry) => sum + entry.amount, 0);
    expect(totalBreakdown).toBe(COUNT * AMOUNT);
  });
});

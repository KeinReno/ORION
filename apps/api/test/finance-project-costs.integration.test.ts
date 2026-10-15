import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/** Plugin `finance-project-costs`: exact sums of the operations booked to one project; transfers never count. */
describe("Finance project costs", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `finance-project-costs-${runId}`;

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

  async function register(name: string) {
    const response = await request<{ accessToken: string }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { token: response.data.accessToken, workspaceId: workspaces.data[0]!.id };
  }

  it("sums income and expense of the project exactly, ignores transfers and other projects", async () => {
    const { token, workspaceId } = await register("sums");
    const base = `/workspaces/${workspaceId}/finance`;
    const project = await request<{ id: string }>(`/workspaces/${workspaceId}/projects`, { method: "POST", token, body: { name: "Ремонт" } });
    const other = await request<{ id: string }>(`/workspaces/${workspaceId}/projects`, { method: "POST", token, body: { name: "Другой" } });
    const a = (await request<{ id: string }>(`${base}/accounts`, { method: "POST", token, body: { name: "Карта", startingBalance: 0 } })).data.id;
    const b = (await request<{ id: string }>(`${base}/accounts`, { method: "POST", token, body: { name: "Нал", startingBalance: 0 } })).data.id;
    const cat = (await request<{ id: string }>(`${base}/categories`, { method: "POST", token, body: { name: "Материалы", kind: "expense" } })).data.id;
    const at = "2026-10-01T10:00:00.000Z";
    const post = (body: object) => request(`${base}/transactions`, { method: "POST", token, body: { occurredAt: at, ...body } });

    expect((await post({ accountId: a, type: "expense", projectId: project.data.id, lines: [{ categoryId: cat, amount: 30000 }, { categoryId: null, amount: 5000 }] })).status).toBe(201);
    expect((await post({ accountId: a, type: "income", projectId: project.data.id, lines: [{ categoryId: null, amount: 10000 }] })).status).toBe(201);
    expect((await post({ accountId: a, toAccountId: b, type: "transfer", projectId: project.data.id, lines: [{ categoryId: null, amount: 99999 }] })).status).toBe(201);
    expect((await post({ accountId: a, type: "expense", projectId: other.data.id, lines: [{ categoryId: cat, amount: 777 }] })).status).toBe(201);

    const costs = await request<{ income: number; expense: number; operationCount: number; mixedCurrencies: boolean; expenseByCategory: { categoryName: string; amount: number }[] }>(
      `${base}/projects/${project.data.id}/costs`,
      { method: "GET", token }
    );
    expect(costs.status).toBe(200);
    expect(costs.data.expense).toBe(35000);
    expect(costs.data.income).toBe(10000);
    expect(costs.data.operationCount).toBe(2);
    expect(costs.data.mixedCurrencies).toBe(false);
    expect(costs.data.expenseByCategory.map((e) => [e.categoryName, e.amount])).toEqual([["Материалы", 30000], ["Без категории", 5000]]);

    const filtered = await request<unknown[]>(`${base}/transactions?projectId=${project.data.id}`, { method: "GET", token });
    expect(filtered.data).toHaveLength(3);
  });

  it("searches the note and the amount range; a category and an amount must hold for the same line", async () => {
    const { token, workspaceId } = await register("search");
    const base = `/workspaces/${workspaceId}/finance`;
    const account = (await request<{ id: string }>(`${base}/accounts`, { method: "POST", token, body: { name: "Карта", startingBalance: 0 } })).data.id;
    const food = (await request<{ id: string }>(`${base}/categories`, { method: "POST", token, body: { name: "Food", kind: "expense" } })).data.id;
    const fun = (await request<{ id: string }>(`${base}/categories`, { method: "POST", token, body: { name: "Fun", kind: "expense" } })).data.id;
    const at = "2026-10-01T10:00:00.000Z";
    const post = (body: object) => request(`${base}/transactions`, { method: "POST", token, body: { accountId: account, type: "expense", occurredAt: at, ...body } });
    await post({ note: "Bread and Milk", lines: [{ categoryId: food, amount: 3000 }] });
    await post({ note: "Cinema", lines: [{ categoryId: fun, amount: 90000 }] });
    // Split: food 1000 + fun 50000 — a «food above 10000» search must NOT match it (food is only 1000 here).
    await post({ note: "Mixed", lines: [{ categoryId: food, amount: 1000 }, { categoryId: fun, amount: 50000 }] });

    const notes = async (query: string) => (await request<{ note: string }[]>(`${base}/transactions?${query}`, { method: "GET", token })).data.map((t) => t.note).sort();
    expect(await notes("q=milk")).toEqual(["Bread and Milk"]);
    expect(await notes("minAmount=40000")).toEqual(["Cinema", "Mixed"]);
    expect(await notes("minAmount=2000&maxAmount=5000")).toEqual(["Bread and Milk"]);
    expect(await notes(`categoryId=${food}&minAmount=10000`)).toEqual([]);
    expect(await notes(`categoryId=${fun}&minAmount=10000`)).toEqual(["Cinema", "Mixed"]);
  });

  it("labels an account with whose money it is and filters operations by that", async () => {
    const { token, workspaceId } = await register("context");
    const base = `/workspaces/${workspaceId}/finance`;
    const mine = await request<{ id: string; context: string }>(`${base}/accounts`, { method: "POST", token, body: { name: "Моя", startingBalance: 0 } });
    const shared = await request<{ id: string; context: string }>(`${base}/accounts`, { method: "POST", token, body: { name: "Семейная", context: "family", startingBalance: 0 } });
    expect(mine.data.context).toBe("personal");
    expect(shared.data.context).toBe("family");
    const at = "2026-10-01T10:00:00.000Z";
    for (const [accountId, note] of [[mine.data.id, "mine"], [shared.data.id, "shared"]] as const) {
      await request(`${base}/transactions`, { method: "POST", token, body: { accountId, type: "expense", note, occurredAt: at, lines: [{ categoryId: null, amount: 100 }] } });
    }
    const notes = async (query: string) => (await request<{ note: string }[]>(`${base}/transactions?${query}`, { method: "GET", token })).data.map((t) => t.note);
    expect(await notes("context=family")).toEqual(["shared"]);
    expect(await notes("context=personal")).toEqual(["mine"]);
    const changed = await request<{ context: string }>(`${base}/accounts/${mine.data.id}`, { method: "PATCH", token, body: { context: "work" } });
    expect(changed.data.context).toBe("work");
    expect((await request(`${base}/accounts`, { method: "POST", token, body: { name: "Плохая", context: "nonsense" } })).status).toBe(400);
  });

  it("rejects a project from another workspace and respects the plugin switch", async () => {
    const alice = await register("alice");
    const bob = await register("bob");
    const foreign = await request<{ id: string }>(`/workspaces/${bob.workspaceId}/projects`, { method: "POST", token: bob.token, body: { name: "Чужой" } });
    const denied = await request(`/workspaces/${alice.workspaceId}/finance/projects/${foreign.data.id}/costs`, { method: "GET", token: alice.token });
    expect(denied.status).toBeGreaterThanOrEqual(400);
    expect(denied.status).not.toBe(200);

    const mine = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/projects`, { method: "POST", token: alice.token, body: { name: "Мой" } });
    await request(`/workspaces/${alice.workspaceId}/plugins/finance-project-costs`, { method: "PATCH", token: alice.token, body: { enabled: false } });
    const off = await request(`/workspaces/${alice.workspaceId}/finance/projects/${mine.data.id}/costs`, { method: "GET", token: alice.token });
    expect(off.status).toBe(409);
  });
});

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * An obligation is a plan: creating or editing one never moves a balance. Paying records a real transaction in the
 * account the payer picks and advances the plan; the same due date cannot be paid twice.
 */
describe("Finance obligations (plan vs ledger)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `finance-obligations-${runId}`;

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

  type Obl = { id: string; principal: number | null; nextDueAt: string | null; closedAt: string | null; payment: number };
  type Pay = { obligation: Obl; transaction: { id: string; type: string; importedRef: string | null; totalAmount: number; accountId: string } };

  async function setup(name: string) {
    const alice = await register(name);
    const base = `/workspaces/${alice.workspaceId}/finance`;
    const account = await request<{ id: string }>(`${base}/accounts`, { method: "POST", token: alice.accessToken, body: { name: "Карта", startingBalance: 1000000 } });
    return { alice, base, accountId: account.data.id };
  }
  const balanceOf = async (base: string, token: string, accountId: string) =>
    (await request<{ id: string; balance: number }[]>(`${base}/accounts`, { method: "GET", token })).data.find((a) => a.id === accountId)!.balance;

  it("creating and editing a plan never moves the balance", async () => {
    const { alice, base, accountId } = await setup("plan");
    const created = await request<Obl>(`${base}/obligations`, { method: "POST", token: alice.accessToken, body: { name: "Кредит", kind: "credit", principal: 600000, payment: 100000, interval: "monthly", nextDueAt: "2026-11-05T09:00:00.000Z" } });
    expect(created.status).toBe(201);
    await request(`${base}/obligations/${created.data.id}`, { method: "PATCH", token: alice.accessToken, body: { payment: 120000 } });
    expect(await balanceOf(base, alice.accessToken, accountId)).toBe(1000000);
    expect((await request<unknown[]>(`${base}/transactions`, { method: "GET", token: alice.accessToken })).data).toHaveLength(0);
  });

  it("paying writes one expense, lowers the principal and moves the due date a month on", async () => {
    const { alice, base, accountId } = await setup("pay");
    const { data: o } = await request<Obl>(`${base}/obligations`, { method: "POST", token: alice.accessToken, body: { name: "Кредит", principal: 600000, payment: 100000, interval: "monthly", nextDueAt: "2026-01-31T09:00:00.000Z" } });
    const paid = await request<Pay>(`${base}/obligations/${o.id}/pay`, { method: "POST", token: alice.accessToken, body: { accountId } });
    expect(paid.status).toBe(201);
    expect(paid.data.transaction).toMatchObject({ type: "expense", totalAmount: 100000, accountId, importedRef: `obligation:${o.id}:2026-01-31` });
    expect(paid.data.obligation.principal).toBe(500000);
    // 31 Jan + 1 month clamps to the last day of February.
    expect(paid.data.obligation.nextDueAt).toBe("2026-02-28T09:00:00.000Z");
    expect(await balanceOf(base, alice.accessToken, accountId)).toBe(900000);
  });

  it("the same due date cannot be paid twice", async () => {
    const { alice, base, accountId } = await setup("double");
    const { data: o } = await request<Obl>(`${base}/obligations`, { method: "POST", token: alice.accessToken, body: { name: "Свет", kind: "utility", payment: 30000, interval: "monthly", nextDueAt: "2026-05-10T09:00:00.000Z" } });
    expect((await request(`${base}/obligations/${o.id}/pay`, { method: "POST", token: alice.accessToken, body: { accountId } })).status).toBe(201);
    // Put the plan back on the same due date and try again.
    await request(`${base}/obligations/${o.id}`, { method: "PATCH", token: alice.accessToken, body: { nextDueAt: "2026-05-10T09:00:00.000Z" } });
    const again = await request(`${base}/obligations/${o.id}/pay`, { method: "POST", token: alice.accessToken, body: { accountId } });
    expect(again.status).toBe(409);
    expect(await balanceOf(base, alice.accessToken, accountId)).toBe(1000000 - 30000);
  });

  it("paying off the principal closes the obligation; a closed one cannot be paid", async () => {
    const { alice, base, accountId } = await setup("close");
    const { data: o } = await request<Obl>(`${base}/obligations`, { method: "POST", token: alice.accessToken, body: { name: "Долг Пете", principal: 50000, payment: 50000, interval: "monthly", nextDueAt: "2026-06-01T09:00:00.000Z" } });
    const paid = await request<Pay>(`${base}/obligations/${o.id}/pay`, { method: "POST", token: alice.accessToken, body: { accountId, amount: 70000 } });
    expect(paid.data.obligation).toMatchObject({ principal: 0, nextDueAt: null });
    expect(paid.data.obligation.closedAt).not.toBeNull();
    expect((await request(`${base}/obligations/${o.id}/pay`, { method: "POST", token: alice.accessToken, body: { accountId } })).status).toBe(409);
  });

  it("money owed to the workspace is income, and a one-off obligation closes after its payment", async () => {
    const { alice, base, accountId } = await setup("owed");
    const { data: o } = await request<Obl>(`${base}/obligations`, { method: "POST", token: alice.accessToken, body: { name: "Вася вернёт", direction: "owed", payment: 20000, interval: "once", nextDueAt: "2026-06-01T09:00:00.000Z" } });
    const paid = await request<Pay>(`${base}/obligations/${o.id}/pay`, { method: "POST", token: alice.accessToken, body: { accountId } });
    expect(paid.data.transaction.type).toBe("income");
    expect(paid.data.obligation.closedAt).not.toBeNull();
    expect(await balanceOf(base, alice.accessToken, accountId)).toBe(1020000);
  });

  it("refuses a foreign account, and another workspace's obligation is invisible", async () => {
    const one = await setup("mine");
    const two = await setup("theirs");
    const { data: o } = await request<Obl>(`${one.base}/obligations`, { method: "POST", token: one.alice.accessToken, body: { name: "Мой", payment: 10000, nextDueAt: "2026-06-01T09:00:00.000Z" } });
    expect((await request(`${one.base}/obligations/${o.id}/pay`, { method: "POST", token: one.alice.accessToken, body: { accountId: two.accountId } })).status).toBe(400);
    expect((await request(`${one.base}/obligations`, { method: "GET", token: two.alice.accessToken })).status).toBe(403);
    expect((await request(`${two.base}/obligations/${o.id}/pay`, { method: "POST", token: two.alice.accessToken, body: { accountId: two.accountId } })).status).toBe(404);
  });
});

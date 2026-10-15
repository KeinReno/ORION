import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/** Plugin `finance-ai-drafts` + scope `finance:draft`: an agent PROPOSES, only a human's confirmation writes. */
describe("Finance drafts from AI agents", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const previousRateLimit = process.env.ORION_AI_RATE_LIMIT;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `finance-drafts-${runId}`;

  beforeAll(async () => {
    process.env.ORION_AI_RATE_LIMIT = "1000";
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (previousRateLimit === undefined) delete process.env.ORION_AI_RATE_LIMIT;
    else process.env.ORION_AI_RATE_LIMIT = previousRateLimit;
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

  async function setup(name: string, scopes: string[] = ["finance:draft"]) {
    const registered = await request<{ accessToken: string }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(registered.status).toBe(201);
    const token = registered.data.accessToken;
    const workspaceId = (await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token })).data[0]!.id;
    const base = `/workspaces/${workspaceId}/finance`;
    const account = (await request<{ id: string }>(`${base}/accounts`, { method: "POST", token, body: { name: "Карта", startingBalance: 1_000_000 } })).data.id;
    const category = (await request<{ id: string }>(`${base}/categories`, { method: "POST", token, body: { name: "Продукты", kind: "expense" } })).data.id;
    const agent = await request<{ id: string; secret: string }>(`/workspaces/${workspaceId}/agent-tokens`, { method: "POST", token, body: { name: "Claude", scopes, expiresInDays: 30 } });
    expect(agent.status).toBe(201);
    return { token, workspaceId, base, account, category, agentSecret: agent.data.secret };
  }

  type Draft = { id: string; status: string; amount: number; transactionId: string | null; tokenName: string; accountId: string | null };
  const draftBody = (extra: object = {}) => ({ amount: 34990, occurredAt: "2026-10-12T09:30:00.000Z", merchant: "Пятёрочка", note: "молоко, хлеб", ...extra });

  it("the agent sees only names, proposes a draft, and NOTHING is written until the human confirms", async () => {
    const ctx = await setup("flow");
    const refs = await request<{ accounts: { id: string; name: string }[]; categories: { id: string }[] }>("/ai/v1/finance/refs", { method: "GET", token: ctx.agentSecret });
    expect(refs.status).toBe(200);
    expect(refs.data.accounts.map((a) => a.id)).toEqual([ctx.account]);
    expect(JSON.stringify(refs.data)).not.toContain("balance");

    const proposed = await request<Draft>("/ai/v1/finance/drafts", { method: "POST", token: ctx.agentSecret, body: draftBody({ accountId: ctx.account, categoryId: ctx.category, confidence: 0.82, sourceNote: "чек из файла IMG_204.jpg" }) });
    expect(proposed.status).toBe(201);
    expect(proposed.data).toMatchObject({ status: "pending", amount: 34990, tokenName: "Claude" });

    // Not money yet: no operation, balance untouched.
    expect((await request<unknown[]>(`${ctx.base}/transactions`, { method: "GET", token: ctx.token })).data).toHaveLength(0);
    const balance = async () => (await request<{ id: string; balance: number }[]>(`${ctx.base}/accounts`, { method: "GET", token: ctx.token })).data.find((a) => a.id === ctx.account)!.balance;
    expect(await balance()).toBe(1_000_000);

    const listed = await request<Draft[]>(`${ctx.base}/drafts`, { method: "GET", token: ctx.token });
    expect(listed.data.map((d) => d.status)).toEqual(["pending"]);

    // The human corrects the amount and confirms.
    const accepted = await request<{ draft: Draft; transaction: { id: string; totalAmount: number; type: string } }>(`${ctx.base}/drafts/${proposed.data.id}/accept`, {
      method: "POST", token: ctx.token,
      body: { accountId: ctx.account, type: "expense", note: "Пятёрочка", tags: [], occurredAt: "2026-10-12T09:30:00.000Z", lines: [{ categoryId: ctx.category, amount: 31990 }] }
    });
    expect(accepted.status).toBe(201);
    expect(accepted.data.transaction).toMatchObject({ totalAmount: 31990, type: "expense" });
    expect(accepted.data.draft).toMatchObject({ status: "approved", transactionId: accepted.data.transaction.id });
    expect(await balance()).toBe(1_000_000 - 31990);

    // A second confirmation cannot write it twice.
    const again = await request(`${ctx.base}/drafts/${proposed.data.id}/accept`, {
      method: "POST", token: ctx.token,
      body: { accountId: ctx.account, type: "expense", note: "", tags: [], occurredAt: "2026-10-12T09:30:00.000Z", lines: [{ categoryId: null, amount: 31990 }] }
    });
    expect(again.status).toBe(409);
    expect(await balance()).toBe(1_000_000 - 31990);
  });

  it("a rejected draft writes nothing, and a failed confirmation puts the draft back", async () => {
    const ctx = await setup("reject");
    const one = await request<Draft>("/ai/v1/finance/drafts", { method: "POST", token: ctx.agentSecret, body: draftBody() });
    expect((await request<Draft>(`${ctx.base}/drafts/${one.data.id}/reject`, { method: "POST", token: ctx.token })).data.status).toBe("rejected");
    expect((await request(`${ctx.base}/drafts/${one.data.id}/reject`, { method: "POST", token: ctx.token })).status).toBe(409);
    expect((await request<unknown[]>(`${ctx.base}/transactions`, { method: "GET", token: ctx.token })).data).toHaveLength(0);

    const two = await request<Draft>("/ai/v1/finance/drafts", { method: "POST", token: ctx.agentSecret, body: draftBody({ amount: 100 }) });
    // A confirmation that cannot be written (a foreign account) fails and leaves the draft pending.
    const bad = await request(`${ctx.base}/drafts/${two.data.id}/accept`, {
      method: "POST", token: ctx.token,
      body: { accountId: "not-an-account", type: "expense", note: "", tags: [], occurredAt: "2026-10-12T09:30:00.000Z", lines: [{ categoryId: null, amount: 100 }] }
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const after = (await request<Draft[]>(`${ctx.base}/drafts`, { method: "GET", token: ctx.token })).data.find((d) => d.id === two.data.id)!;
    expect(after.status).toBe("pending");
  });

  it("is idempotent for a retry, capped per token, and refuses foreign references", async () => {
    const ctx = await setup("limits");
    const a = await request<Draft>("/ai/v1/finance/drafts", { method: "POST", token: ctx.agentSecret, body: draftBody() });
    const b = await request<Draft>("/ai/v1/finance/drafts", { method: "POST", token: ctx.agentSecret, body: draftBody() });
    expect(b.data.id).toBe(a.data.id);

    const other = await setup("limits-other");
    const foreign = await request("/ai/v1/finance/drafts", { method: "POST", token: ctx.agentSecret, body: draftBody({ accountId: other.account }) });
    expect(foreign.status).toBe(400);
    expect((await request("/ai/v1/finance/drafts", { method: "POST", token: ctx.agentSecret, body: draftBody({ categoryId: other.category }) })).status).toBe(400);

    for (let i = 1; i < 50; i += 1) {
      expect((await request("/ai/v1/finance/drafts", { method: "POST", token: ctx.agentSecret, body: draftBody({ amount: 1000 + i }) })).status).toBe(201);
    }
    expect((await request("/ai/v1/finance/drafts", { method: "POST", token: ctx.agentSecret, body: draftBody({ amount: 99999 }) })).status).toBe(429);
  });

  it("needs the scope and the plugin, and can never write an operation itself", async () => {
    const noScope = await setup("noscope", ["tasks:read"]);
    expect((await request("/ai/v1/finance/refs", { method: "GET", token: noScope.agentSecret })).status).toBe(403);
    expect((await request("/ai/v1/finance/drafts", { method: "POST", token: noScope.agentSecret, body: draftBody() })).status).toBe(403);

    const ctx = await setup("gate");
    // There is no agent route that writes an operation, and a draft cannot be a transfer.
    expect((await request("/ai/v1/finance/transactions", { method: "POST", token: ctx.agentSecret, body: draftBody() })).status).toBe(404);
    expect((await request<Draft>("/ai/v1/finance/drafts", { method: "POST", token: ctx.agentSecret, body: draftBody({ type: "transfer" }) })).status).toBe(400);
    expect((await request("/ai/v1/finance/drafts", { method: "POST", token: ctx.agentSecret, body: draftBody({ amount: 0 }) })).status).toBe(400);

    await request("/ai/v1/finance/drafts", { method: "POST", token: ctx.agentSecret, body: draftBody() });
    await request(`/workspaces/${ctx.workspaceId}/plugins/finance-ai-drafts`, { method: "PATCH", token: ctx.token, body: { enabled: false } });
    expect((await request("/ai/v1/finance/refs", { method: "GET", token: ctx.agentSecret })).status).toBe(409);
    expect((await request(`${ctx.base}/drafts`, { method: "GET", token: ctx.token })).status).toBe(409);
    await request(`/workspaces/${ctx.workspaceId}/plugins/finance-ai-drafts`, { method: "PATCH", token: ctx.token, body: { enabled: true } });
    expect((await request<Draft[]>(`${ctx.base}/drafts`, { method: "GET", token: ctx.token })).data).toHaveLength(1);
  });
});

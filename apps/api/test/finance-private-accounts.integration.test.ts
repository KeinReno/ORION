import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Private accounts: an account (and everything on it) visible only to its owner — enforced by Row Level Security, so
 * it holds for every query, not just the ones that remembered a filter.
 */
describe("Finance private accounts", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `finance-private-${runId}`;

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
    const email = `${emailPrefix}-${name}@example.test`;
    const registered = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email, password: "integration-password-123", name }
    });
    expect(registered.status).toBe(201);
    const token = registered.data.accessToken;
    const workspaceId = (await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token })).data[0]!.id;
    return { token, email, userId: registered.data.user.id, workspaceId };
  }

  /** Anya owns the workspace, Petya is a member. */
  async function pair(name: string) {
    const anya = await register(`${name}-anya`);
    const petya = await register(`${name}-petya`);
    const invite = await request<{ acceptUrl: string }>(`/workspaces/${anya.workspaceId}/invites`, { method: "POST", token: anya.token, body: { email: petya.email } });
    const inviteToken = new URL(invite.data.acceptUrl).searchParams.get("token")!;
    expect((await request(`/invites/${inviteToken}/accept`, { method: "POST", token: petya.token })).status).toBe(201);
    return { anya, petya, ws: anya.workspaceId, base: `/workspaces/${anya.workspaceId}/finance` };
  }

  type Acc = { id: string; name: string; visibility: string; ownerId: string | null; balance: number };
  type Tx = { id: string; note: string; type: string };
  const at = "2026-10-01T10:00:00.000Z";

  it("hides a private account and everything on it from the other member, but not from its owner", async () => {
    const { anya, petya, base } = await pair("hide");
    const shared = (await request<Acc>(`${base}/accounts`, { method: "POST", token: anya.token, body: { name: "Общий", startingBalance: 0 } })).data;
    const mine = await request<Acc>(`${base}/accounts`, { method: "POST", token: anya.token, body: { name: "Личный", visibility: "private", startingBalance: 100000 } });
    expect(mine.data).toMatchObject({ visibility: "private", ownerId: anya.userId });

    const post = (token: string, accountId: string, note: string, amount: number) =>
      request<Tx>(`${base}/transactions`, { method: "POST", token, body: { accountId, type: "expense", note, occurredAt: at, lines: [{ categoryId: null, amount }] } });
    expect((await post(anya.token, mine.data.id, "секрет", 7000)).status).toBe(201);
    expect((await post(anya.token, shared.id, "общее", 3000)).status).toBe(201);

    const petyaAccounts = (await request<Acc[]>(`${base}/accounts`, { method: "GET", token: petya.token })).data;
    expect(petyaAccounts.map((a) => a.name)).toEqual(["Общий"]);
    expect((await request<Tx[]>(`${base}/transactions`, { method: "GET", token: petya.token })).data.map((t) => t.note)).toEqual(["общее"]);
    // Anya sees both.
    expect((await request<Acc[]>(`${base}/accounts`, { method: "GET", token: anya.token })).data).toHaveLength(2);
    expect((await request<Tx[]>(`${base}/transactions`, { method: "GET", token: anya.token })).data).toHaveLength(2);

    // Reports and project/line aggregates cannot leak the hidden amounts either.
    const monthly = (await request<{ expense: number }[]>(`${base}/reports/monthly?months=1`, { method: "GET", token: petya.token })).data;
    expect(monthly[monthly.length - 1]!.expense).toBeLessThanOrEqual(3000);
    const petyaMonth = await request<{ categoryName: string; amount: number }[]>(`${base}/reports/categories?from=2026-10-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z`, { method: "GET", token: petya.token });
    expect(petyaMonth.data.reduce((sum, row) => sum + row.amount, 0)).toBe(3000);

    // The other member cannot post to it, patch it, read it by id, or delete it.
    expect((await post(petya.token, mine.data.id, "взлом", 1)).status).toBeGreaterThanOrEqual(400);
    expect((await request(`${base}/accounts/${mine.data.id}`, { method: "PATCH", token: petya.token, body: { name: "взлом" } })).status).toBe(404);
    expect((await request(`${base}/accounts/${mine.data.id}`, { method: "DELETE", token: petya.token })).status).toBe(404);
    const hiddenTx = (await request<Tx[]>(`${base}/transactions`, { method: "GET", token: anya.token })).data.find((t) => t.note === "секрет")!;
    expect((await request(`${base}/transactions/${hiddenTx.id}`, { method: "GET", token: petya.token })).status).toBe(404);
  });

  it("a transfer from a shared account into a private one stays visible where the shared account is, with the right balance", async () => {
    const { anya, petya, base } = await pair("transfer");
    const shared = (await request<Acc>(`${base}/accounts`, { method: "POST", token: anya.token, body: { name: "Общий", startingBalance: 50000 } })).data;
    const mine = (await request<Acc>(`${base}/accounts`, { method: "POST", token: anya.token, body: { name: "Личный", visibility: "private" } })).data;
    const moved = await request<Tx>(`${base}/transactions`, {
      method: "POST", token: anya.token,
      body: { accountId: shared.id, toAccountId: mine.id, type: "transfer", note: "на себя", occurredAt: at, lines: [{ categoryId: null, amount: 20000 }] }
    });
    expect(moved.status).toBe(201);

    // Petya sees the transfer (it leaves the shared account) and the shared balance is right.
    expect((await request<Tx[]>(`${base}/transactions`, { method: "GET", token: petya.token })).data.map((t) => t.type)).toEqual(["transfer"]);
    const petyaShared = (await request<Acc[]>(`${base}/accounts`, { method: "GET", token: petya.token })).data.find((a) => a.id === shared.id)!;
    expect(petyaShared.balance).toBe(30000);
    // ...but he cannot move money into someone's private account.
    const intrusion = await request(`${base}/transactions`, {
      method: "POST", token: petya.token,
      body: { accountId: shared.id, toAccountId: mine.id, type: "transfer", occurredAt: at, lines: [{ categoryId: null, amount: 1 }] }
    });
    expect(intrusion.status).toBeGreaterThanOrEqual(400);
  });

  it("only the creator (or the workspace owner, for an old account) may hide a shared account", async () => {
    const { anya, petya, base, ws } = await pair("rules");
    const shared = (await request<Acc>(`${base}/accounts`, { method: "POST", token: anya.token, body: { name: "Общий", startingBalance: 0 } })).data;

    // Petya did not create it: he cannot take it away from everyone else.
    expect((await request(`${base}/accounts/${shared.id}`, { method: "PATCH", token: petya.token, body: { visibility: "private" } })).status).toBe(403);
    expect((await request<Acc[]>(`${base}/accounts`, { method: "GET", token: petya.token })).data.map((a) => a.id)).toContain(shared.id);

    // The creator can, and can give it back.
    expect((await request<Acc>(`${base}/accounts/${shared.id}`, { method: "PATCH", token: anya.token, body: { visibility: "private" } })).data.visibility).toBe("private");
    expect((await request<Acc[]>(`${base}/accounts`, { method: "GET", token: petya.token })).data.map((a) => a.id)).not.toContain(shared.id);
    expect((await request<Acc>(`${base}/accounts/${shared.id}`, { method: "PATCH", token: anya.token, body: { visibility: "workspace" } })).data.visibility).toBe("workspace");

    // An account older than the owner column (ownerId null): only the workspace owner may hide it, not a plain member.
    const legacy = await prisma.asSystem((tx) => tx.account.create({ data: { workspaceId: ws, name: "Старый" } }));
    expect(legacy.ownerId).toBeNull();
    expect((await request(`${base}/accounts/${legacy.id}`, { method: "PATCH", token: petya.token, body: { visibility: "private" } })).status).toBe(403);
    const hidden = await request<Acc>(`${base}/accounts/${legacy.id}`, { method: "PATCH", token: anya.token, body: { visibility: "private" } });
    expect(hidden.data).toMatchObject({ visibility: "private", ownerId: anya.userId });
  });

  it("hides rules, goals and obligations that sit on a private account, and gives the account back when its owner leaves", async () => {
    const { anya, petya, base, ws } = await pair("leave");
    const mine = (await request<Acc>(`${base}/accounts`, { method: "POST", token: petya.token, body: { name: "Личный Пети", visibility: "private", startingBalance: 1000 } })).data;
    const sharedAcc = (await request<Acc>(`${base}/accounts`, { method: "POST", token: anya.token, body: { name: "Общий" } })).data;

    await request(`${base}/obligations`, { method: "POST", token: petya.token, body: { name: "Кредит с личного", payment: 100, accountId: mine.id, nextDueAt: "2026-11-01T09:00:00.000Z" } });
    await request(`${base}/obligations`, { method: "POST", token: petya.token, body: { name: "Общий платёж", payment: 100, accountId: sharedAcc.id, nextDueAt: "2026-11-01T09:00:00.000Z" } });
    await request(`${base}/obligations`, { method: "POST", token: petya.token, body: { name: "Без счёта", payment: 100, nextDueAt: "2026-11-01T09:00:00.000Z" } });
    await request(`${base}/recurring`, { method: "POST", token: petya.token, body: { accountId: mine.id, type: "expense", amount: 100, note: "личная подписка", interval: "monthly", anchorDay: 5, nextRunAt: "2026-11-05T09:00:00.000Z" } });

    const names = async (token: string) => (await request<{ name: string }[]>(`${base}/obligations`, { method: "GET", token })).data.map((o) => o.name).sort();
    expect(await names(petya.token)).toEqual(["Без счёта", "Кредит с личного", "Общий платёж"]);
    expect(await names(anya.token)).toEqual(["Без счёта", "Общий платёж"]);
    expect((await request<unknown[]>(`${base}/recurring`, { method: "GET", token: anya.token })).data).toHaveLength(0);
    expect((await request<unknown[]>(`${base}/recurring`, { method: "GET", token: petya.token })).data).toHaveLength(1);

    // Petya leaves: his private account does not vanish for good — the workspace gets it back.
    const members = (await request<{ id: string; userId: string }[]>(`/workspaces/${ws}/members`, { method: "GET", token: anya.token })).data;
    const petyaMember = members.find((m) => m.userId === petya.userId)!;
    expect((await request(`/workspaces/${ws}/members/${petyaMember.id}`, { method: "DELETE", token: anya.token })).status).toBeLessThan(300);
    expect((await request<Acc[]>(`${base}/accounts`, { method: "GET", token: anya.token })).data.map((a) => a.name).sort()).toEqual(["Личный Пети", "Общий"]);
    expect(await names(anya.token)).toContain("Кредит с личного");
  });
});

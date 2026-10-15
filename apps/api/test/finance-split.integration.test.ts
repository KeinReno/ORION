import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/** Plugin `finance-split`: a ledger between members — exact balances, no account balance ever moves. */
describe("Finance split (кто кому должен)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `finance-split-${runId}`;

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

  async function pair(name: string) {
    const anya = await register(`${name}-anya`);
    const petya = await register(`${name}-petya`);
    const invite = await request<{ acceptUrl: string }>(`/workspaces/${anya.workspaceId}/invites`, { method: "POST", token: anya.token, body: { email: petya.email } });
    expect(invite.status).toBe(201);
    const inviteToken = new URL(invite.data.acceptUrl).searchParams.get("token")!;
    expect((await request(`/invites/${inviteToken}/accept`, { method: "POST", token: petya.token })).status).toBe(201);
    return { anya, petya, ws: anya.workspaceId, base: `/workspaces/${anya.workspaceId}/finance/splits` };
  }

  type Overview = { splits: { id: string; shares: unknown[] }[]; settlements: { id: string }[]; balances: { userId: string; currency: string; net: number }[] };
  const at = "2026-10-01T10:00:00.000Z";

  it("keeps exact balances, accepts settlements and moves no account balance", async () => {
    const { anya, petya, ws, base } = await pair("balances");
    const account = (await request<{ id: string }>(`/workspaces/${ws}/finance/accounts`, { method: "POST", token: anya.token, body: { name: "Карта", startingBalance: 500000 } })).data.id;

    const created = await request<{ id: string }>(base, {
      method: "POST", token: anya.token,
      body: { title: "Продукты", amount: 3001, paidById: anya.userId, occurredAt: at, shares: [{ userId: anya.userId, share: 1501 }, { userId: petya.userId, share: 1500 }] }
    });
    expect(created.status).toBe(201);

    let overview = (await request<Overview>(base, { method: "GET", token: petya.token })).data;
    expect(overview.splits).toHaveLength(1);
    expect(overview.balances).toEqual([
      { userId: anya.userId, currency: "RUB", net: 1500 },
      { userId: petya.userId, currency: "RUB", net: -1500 }
    ]);

    expect((await request(`${base}/settlements`, { method: "POST", token: petya.token, body: { fromUserId: petya.userId, toUserId: anya.userId, amount: 500, occurredAt: at } })).status).toBe(201);
    overview = (await request<Overview>(base, { method: "GET", token: anya.token })).data;
    expect(overview.balances.find((b) => b.userId === petya.userId)!.net).toBe(-1000);

    expect((await request(`${base}/settlements`, { method: "POST", token: petya.token, body: { fromUserId: petya.userId, toUserId: anya.userId, amount: 1000, occurredAt: at } })).status).toBe(201);
    expect((await request<Overview>(base, { method: "GET", token: anya.token })).data.balances).toEqual([]);

    // The account ledger was never touched.
    const balance = (await request<{ id: string; balance: number }[]>(`/workspaces/${ws}/finance/accounts`, { method: "GET", token: anya.token })).data.find((a) => a.id === account)!.balance;
    expect(balance).toBe(500000);
  });

  it("tells each person who now owes something — and the actor nothing about their own action", async () => {
    const { anya, petya, ws, base } = await pair("notify");
    const inbox = async (token: string) => {
      const response = await request<{ items?: { title: string; body: string }[] } | { title: string; body: string }[]>(`/workspaces/${ws}/notifications`, { method: "GET", token });
      expect(response.status).toBe(200);
      const list = Array.isArray(response.data) ? response.data : (response.data?.items ?? []);
      return list.filter((n) => n.title.startsWith("Общий расход") || n.title.startsWith("Взаиморасчёт"));
    };

    await request(base, {
      method: "POST", token: anya.token,
      body: { title: "Продукты", amount: 3000, paidById: anya.userId, occurredAt: at, shares: [{ userId: anya.userId, share: 1500 }, { userId: petya.userId, share: 1500 }] }
    });
    const forPetya = await inbox(petya.token);
    expect(forPetya).toHaveLength(1);
    expect(forPetya[0]!.body).toContain("15.00");
    expect(await inbox(anya.token)).toHaveLength(0); // the payer and the actor: nothing about their own expense

    await request(`${base}/settlements`, { method: "POST", token: petya.token, body: { fromUserId: petya.userId, toUserId: anya.userId, amount: 1500, occurredAt: at } });
    expect((await inbox(anya.token)).map((n) => n.title)).toEqual(["Взаиморасчёт записан"]);
    expect(await inbox(petya.token)).toHaveLength(1); // still only the expense: he recorded the settlement himself
  });

  it("rejects shares that do not add up, strangers, and self-settlement", async () => {
    const { anya, petya, ws, base } = await pair("validation");
    const stranger = await register("validation-stranger");
    const post = (body: object) => request(base, { method: "POST", token: anya.token, body: { title: "X", amount: 1000, paidById: anya.userId, occurredAt: at, ...body } });

    expect((await post({ shares: [{ userId: anya.userId, share: 400 }, { userId: petya.userId, share: 400 }] })).status).toBe(400);
    expect((await post({ shares: [{ userId: anya.userId, share: 500 }, { userId: stranger.userId, share: 500 }] })).status).toBe(400);
    expect((await post({ paidById: stranger.userId, shares: [{ userId: anya.userId, share: 1000 }] })).status).toBe(400);
    expect((await request(`${base}/settlements`, { method: "POST", token: anya.token, body: { fromUserId: anya.userId, toUserId: anya.userId, amount: 1, occurredAt: at } })).status).toBe(400);
    expect((await request(`${base}/settlements`, { method: "POST", token: anya.token, body: { fromUserId: anya.userId, toUserId: stranger.userId, amount: 1, occurredAt: at } })).status).toBe(400);
    expect((await request<Overview>(base, { method: "GET", token: anya.token })).data.splits).toHaveLength(0);
    expect(ws).toBeTruthy();
  });

  it("only the recorder or the payer can delete an expense; it is gone from the balances", async () => {
    const { anya, petya, base } = await pair("delete");
    const created = await request<{ id: string }>(base, {
      method: "POST", token: anya.token,
      body: { title: "Кино", amount: 1000, paidById: anya.userId, occurredAt: at, shares: [{ userId: anya.userId, share: 500 }, { userId: petya.userId, share: 500 }] }
    });
    const other = await register("delete-other");
    expect((await request(`${base}/${created.data.id}`, { method: "DELETE", token: other.token })).status).toBe(403);

    // Petya is neither the recorder nor the payer.
    expect((await request(`${base}/${created.data.id}`, { method: "DELETE", token: petya.token })).status).toBe(403);
    expect((await request(`${base}/${created.data.id}`, { method: "DELETE", token: anya.token })).status).toBe(200);
    expect((await request<Overview>(base, { method: "GET", token: anya.token })).data.balances).toEqual([]);
  });

  it("is isolated between workspaces and off with the plugin", async () => {
    const { anya, petya, ws, base } = await pair("gate");
    await request(base, {
      method: "POST", token: anya.token,
      body: { title: "Секрет", amount: 100, paidById: anya.userId, occurredAt: at, shares: [{ userId: anya.userId, share: 50 }, { userId: petya.userId, share: 50 }] }
    });
    const outsider = await register("gate-outsider");
    expect((await request(base, { method: "GET", token: outsider.token })).status).toBe(403);

    await request(`/workspaces/${ws}/plugins/finance-split`, { method: "PATCH", token: anya.token, body: { enabled: false } });
    expect((await request(base, { method: "GET", token: anya.token })).status).toBe(409);
    await request(`/workspaces/${ws}/plugins/finance-split`, { method: "PATCH", token: anya.token, body: { enabled: true } });
    // Switching off never deleted anything.
    expect((await request<Overview>(base, { method: "GET", token: anya.token })).data.splits).toHaveLength(1);
  });
});

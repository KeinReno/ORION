import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * The module is OFF in every new workspace. The journal import keeps each trade's mode, never duplicates a trade,
 * and a trade is never a finance transaction by itself — only an explicit fee action writes one, once.
 */
describe("Markets module (watchlist, Compass journal, fee bridge)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `markets-${runId}`;

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

  type Trade = { id: string; mode: string; externalUid: string; feeTransactionId: string | null; symbol: string };
  type Imported = { dryRun: boolean; imported: number; duplicates: number; byMode: { real: number; paper: number; historical: number } };

  async function setup(name: string, enable = true) {
    const alice = await register(name);
    const modules = `/workspaces/${alice.workspaceId}/modules`;
    if (enable) await request(`${modules}/markets`, { method: "PATCH", token: alice.accessToken, body: { enabled: true } });
    const finance = `/workspaces/${alice.workspaceId}/finance`;
    const account = await request<{ id: string }>(`${finance}/accounts`, { method: "POST", token: alice.accessToken, body: { name: "Брокер", startingBalance: 1000000 } });
    return { alice, base: `/workspaces/${alice.workspaceId}/markets`, finance, accountId: account.data.id };
  }
  const entry = (uid: string, over: Record<string, unknown> = {}) => ({ uid, mode: "real", market: "moex", symbol: "SBER", side: "buy", qty: 10, price: 250.5, fee: 1.5, ts: 1_770_000_000_000, note: "", ...over });

  it("is off in a new workspace until the owner turns it on", async () => {
    const { alice, base } = await setup("off", false);
    expect((await request(`${base}/watchlist`, { method: "GET", token: alice.accessToken })).status).toBe(409);
    await request(`/workspaces/${alice.workspaceId}/modules/markets`, { method: "PATCH", token: alice.accessToken, body: { enabled: true } });
    expect((await request(`${base}/watchlist`, { method: "GET", token: alice.accessToken })).status).toBe(200);
  });

  it("keeps a watchlist: one entry per instrument, instruments normalised", async () => {
    const { alice, base } = await setup("watch");
    const added = await request<{ id: string; symbol: string; market: string }>(`${base}/watchlist`, { method: "POST", token: alice.accessToken, body: { market: "MOEX", symbol: "sber", name: "Сбер" } });
    expect(added.status).toBe(201);
    expect(added.data).toMatchObject({ symbol: "SBER", market: "moex" });
    expect((await request(`${base}/watchlist`, { method: "POST", token: alice.accessToken, body: { market: "moex", symbol: "SBER" } })).status).toBe(409);
    expect((await request<unknown[]>(`${base}/watchlist`, { method: "GET", token: alice.accessToken })).data).toHaveLength(1);
    expect((await request(`${base}/watchlist/${added.data.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(200);
  });

  it("imports a journal: dry run first, modes kept, the same file again adds nothing", async () => {
    const { alice, base } = await setup("import");
    const entries = [entry("a"), entry("b", { mode: "paper" }), entry("c", { mode: "historical", side: "sell" })];
    const dry = await request<Imported>(`${base}/trades/import`, { method: "POST", token: alice.accessToken, body: { source: "compass", entries } });
    expect(dry.data).toEqual({ dryRun: true, imported: 3, duplicates: 0, byMode: { real: 1, paper: 1, historical: 1 } });
    expect((await request<Trade[]>(`${base}/trades`, { method: "GET", token: alice.accessToken })).data).toHaveLength(0);

    const real = await request<Imported>(`${base}/trades/import`, { method: "POST", token: alice.accessToken, body: { source: "compass", dryRun: false, entries } });
    expect(real.data).toMatchObject({ imported: 3, duplicates: 0 });
    const all = await request<Trade[]>(`${base}/trades`, { method: "GET", token: alice.accessToken });
    expect(all.data.map((t) => t.mode).sort()).toEqual(["historical", "paper", "real"]);
    expect((await request<Trade[]>(`${base}/trades?mode=paper`, { method: "GET", token: alice.accessToken })).data).toHaveLength(1);

    const again = await request<Imported>(`${base}/trades/import`, { method: "POST", token: alice.accessToken, body: { source: "compass", dryRun: false, entries: [...entries, entry("d")] } });
    expect(again.data).toMatchObject({ imported: 1, duplicates: 3 });
  });

  it("an imported trade is not a transaction; recording the fee is explicit, real-only and happens once", async () => {
    const { alice, base, finance, accountId } = await setup("fee");
    await request(`${base}/trades/import`, { method: "POST", token: alice.accessToken, body: { source: "compass", dryRun: false, entries: [entry("real1"), entry("paper1", { mode: "paper" })] } });
    expect((await request<unknown[]>(`${finance}/transactions`, { method: "GET", token: alice.accessToken })).data).toHaveLength(0);
    const trades = (await request<Trade[]>(`${base}/trades`, { method: "GET", token: alice.accessToken })).data;
    const real = trades.find((t) => t.mode === "real")!;
    const paper = trades.find((t) => t.mode === "paper")!;

    expect((await request(`${base}/trades/${paper.id}/fee`, { method: "POST", token: alice.accessToken, body: { accountId, amount: 150 } })).status).toBe(409);
    const ok = await request<Trade>(`${base}/trades/${real.id}/fee`, { method: "POST", token: alice.accessToken, body: { accountId, amount: 150 } });
    expect(ok.status).toBe(201);
    expect(ok.data.feeTransactionId).not.toBeNull();
    const txs = (await request<{ type: string; totalAmount: number; importedRef: string }[]>(`${finance}/transactions`, { method: "GET", token: alice.accessToken })).data;
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ type: "expense", totalAmount: 150, importedRef: `investments:fee:${real.id}` });
    const balance = (await request<{ id: string; balance: number }[]>(`${finance}/accounts`, { method: "GET", token: alice.accessToken })).data.find((a) => a.id === accountId)!.balance;
    expect(balance).toBe(1000000 - 150);
    expect((await request(`${base}/trades/${real.id}/fee`, { method: "POST", token: alice.accessToken, body: { accountId, amount: 150 } })).status).toBe(409);
  });

  it("refuses a foreign account and keeps another workspace's trades invisible", async () => {
    const one = await setup("mine");
    const two = await setup("theirs");
    await request(`${one.base}/trades/import`, { method: "POST", token: one.alice.accessToken, body: { source: "compass", dryRun: false, entries: [entry("x")] } });
    const trade = (await request<Trade[]>(`${one.base}/trades`, { method: "GET", token: one.alice.accessToken })).data[0]!;
    expect((await request(`${one.base}/trades/${trade.id}/fee`, { method: "POST", token: one.alice.accessToken, body: { accountId: two.accountId, amount: 10 } })).status).toBe(400);
    expect((await request(`${one.base}/trades`, { method: "GET", token: two.alice.accessToken })).status).toBe(403);
    expect((await request(`${two.base}/trades/${trade.id}`, { method: "DELETE", token: two.alice.accessToken })).status).toBe(404);
  });

  it("validates trades: non-positive quantity, unknown mode, empty or oversized batch", async () => {
    const { alice, base } = await setup("shape");
    const post = (entries: unknown[]) => request(`${base}/trades/import`, { method: "POST", token: alice.accessToken, body: { source: "compass", entries } });
    expect((await post([])).status).toBe(400);
    expect((await post([entry("q", { qty: 0 })])).status).toBe(400);
    expect((await post([entry("m", { mode: "demo" })])).status).toBe(400);
    expect((await post(Array.from({ length: 2001 }, (_, i) => entry(`e${i}`)))).status).toBe(400);
  });
});

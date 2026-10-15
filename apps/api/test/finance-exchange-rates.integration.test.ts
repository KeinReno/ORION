import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/** Plugin `finance-exchange-rates`: rates typed by hand — one per pair per day, workspace-scoped, off with the plugin. */
describe("Finance exchange rates", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `finance-rates-${runId}`;

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

  async function setup(name: string) {
    const registered = await request<{ accessToken: string }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(registered.status).toBe(201);
    const token = registered.data.accessToken;
    const workspaceId = (await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token })).data[0]!.id;
    return { token, workspaceId, base: `/workspaces/${workspaceId}/finance` };
  }

  type R = { id: string; base: string; quote: string; rateMicro: number; day: string };

  it("keeps one rate per pair per day (a second entry replaces it) and lists newest first", async () => {
    const ctx = await setup("upsert");
    const put = (body: object) => request<R>(`${ctx.base}/exchange-rates`, { method: "PUT", token: ctx.token, body });
    const first = await put({ base: "USD", quote: "RUB", rateMicro: 90_000_000, day: "2026-10-01" });
    expect(first.status).toBe(200);
    const again = await put({ base: "USD", quote: "RUB", rateMicro: 92_500_000, day: "2026-10-01" });
    expect(again.data.id).toBe(first.data.id);
    expect(again.data).toMatchObject({ rateMicro: 92_500_000, day: "2026-10-01" });
    await put({ base: "USD", quote: "RUB", rateMicro: 95_000_000, day: "2026-10-10" });
    await put({ base: "EUR", quote: "RUB", rateMicro: 100_000_000, day: "2026-10-05" });

    const list = await request<R[]>(`${ctx.base}/exchange-rates`, { method: "GET", token: ctx.token });
    expect(list.data.map((r) => `${r.base}/${r.quote}@${r.day}`)).toEqual(["USD/RUB@2026-10-10", "EUR/RUB@2026-10-05", "USD/RUB@2026-10-01"]);
    expect((await request(`${ctx.base}/exchange-rates/${again.data.id}`, { method: "DELETE", token: ctx.token })).status).toBe(200);
    expect((await request<R[]>(`${ctx.base}/exchange-rates`, { method: "GET", token: ctx.token })).data).toHaveLength(2);
  });

  it("rejects nonsense", async () => {
    const ctx = await setup("validation");
    const put = (body: object) => request(`${ctx.base}/exchange-rates`, { method: "PUT", token: ctx.token, body });
    expect((await put({ base: "USD", quote: "USD", rateMicro: 1, day: "2026-10-01" })).status).toBe(400);
    expect((await put({ base: "usd", quote: "RUB", rateMicro: 1, day: "2026-10-01" })).status).toBe(400);
    expect((await put({ base: "USD", quote: "RUB", rateMicro: 0, day: "2026-10-01" })).status).toBe(400);
    expect((await put({ base: "USD", quote: "RUB", rateMicro: 5, day: "1 октября" })).status).toBe(400);
  });

  it("is isolated between workspaces, and off with the plugin without losing the rates", async () => {
    const one = await setup("iso-one");
    const two = await setup("iso-two");
    const saved = await request<R>(`${one.base}/exchange-rates`, { method: "PUT", token: one.token, body: { base: "USD", quote: "RUB", rateMicro: 90_000_000, day: "2026-10-01" } });
    expect((await request<R[]>(`${two.base}/exchange-rates`, { method: "GET", token: two.token })).data).toEqual([]);
    expect((await request(`${one.base}/exchange-rates`, { method: "GET", token: two.token })).status).toBe(403);
    expect((await request(`${two.base}/exchange-rates/${saved.data.id}`, { method: "DELETE", token: two.token })).status).toBe(404);

    await request(`/workspaces/${one.workspaceId}/plugins/finance-exchange-rates`, { method: "PATCH", token: one.token, body: { enabled: false } });
    expect((await request(`${one.base}/exchange-rates`, { method: "GET", token: one.token })).status).toBe(409);
    await request(`/workspaces/${one.workspaceId}/plugins/finance-exchange-rates`, { method: "PATCH", token: one.token, body: { enabled: true } });
    expect((await request<R[]>(`${one.base}/exchange-rates`, { method: "GET", token: one.token })).data).toHaveLength(1);
  });
});

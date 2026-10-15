import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/** Plugin `finance-templates`: saved starting points; never money, workspace-scoped, switched off with the plugin. */
describe("Finance templates", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `finance-templates-${runId}`;

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

  type T = { id: string; name: string; type: string; amount: number | null; categoryId: string | null; toAccountId: string | null; sortOrder: number };

  it("creates, orders, edits and deletes templates without touching any balance", async () => {
    const ctx = await setup("crud");
    const account = (await request<{ id: string }>(`${ctx.base}/accounts`, { method: "POST", token: ctx.token, body: { name: "Карта", startingBalance: 100000 } })).data.id;
    const category = (await request<{ id: string }>(`${ctx.base}/categories`, { method: "POST", token: ctx.token, body: { name: "Еда", kind: "expense" } })).data.id;

    const lunch = await request<T>(`${ctx.base}/templates`, { method: "POST", token: ctx.token, body: { name: "Обед", accountId: account, categoryId: category, amount: 35000 } });
    const fuel = await request<T>(`${ctx.base}/templates`, { method: "POST", token: ctx.token, body: { name: "Заправка", accountId: account } });
    expect(lunch.status).toBe(201);
    expect(fuel.data.amount).toBeNull();
    expect(fuel.data.sortOrder).toBeGreaterThan(lunch.data.sortOrder);

    const list = await request<T[]>(`${ctx.base}/templates`, { method: "GET", token: ctx.token });
    expect(list.data.map((t) => t.name)).toEqual(["Обед", "Заправка"]);

    // A transfer template keeps no category, whatever was sent.
    const transfer = await request<T>(`${ctx.base}/templates`, { method: "POST", token: ctx.token, body: { name: "Накопления", type: "transfer", categoryId: category, toAccountId: account } });
    expect(transfer.data).toMatchObject({ type: "transfer", categoryId: null, toAccountId: account });

    const edited = await request<T>(`${ctx.base}/templates/${fuel.data.id}`, { method: "PATCH", token: ctx.token, body: { amount: 250000, name: "Бензин" } });
    expect(edited.data).toMatchObject({ name: "Бензин", amount: 250000 });
    expect((await request(`${ctx.base}/templates/${lunch.data.id}`, { method: "DELETE", token: ctx.token })).status).toBe(200);
    expect((await request<T[]>(`${ctx.base}/templates`, { method: "GET", token: ctx.token })).data).toHaveLength(2);

    // None of it moved money.
    const balance = (await request<{ id: string; balance: number }[]>(`${ctx.base}/accounts`, { method: "GET", token: ctx.token })).data.find((a) => a.id === account)!.balance;
    expect(balance).toBe(100000);
    expect((await request<unknown[]>(`${ctx.base}/transactions`, { method: "GET", token: ctx.token })).data).toHaveLength(0);
  });

  it("refuses foreign references and other workspaces, and is off with the plugin", async () => {
    const one = await setup("iso-one");
    const two = await setup("iso-two");
    const foreignAccount = (await request<{ id: string }>(`${two.base}/accounts`, { method: "POST", token: two.token, body: { name: "Чужой" } })).data.id;

    expect((await request(`${one.base}/templates`, { method: "POST", token: one.token, body: { name: "X", accountId: foreignAccount } })).status).toBe(400);
    expect((await request(`${one.base}/templates`, { method: "POST", token: one.token, body: { name: "" } })).status).toBe(400);

    const mine = (await request<T>(`${one.base}/templates`, { method: "POST", token: one.token, body: { name: "Мой" } })).data.id;
    expect((await request<T[]>(`${two.base}/templates`, { method: "GET", token: two.token })).data).toEqual([]);
    expect((await request(`${two.base}/templates/${mine}`, { method: "PATCH", token: two.token, body: { name: "взлом" } })).status).toBe(404);
    expect((await request(`${one.base}/templates`, { method: "GET", token: two.token })).status).toBe(403);

    await request(`/workspaces/${one.workspaceId}/plugins/finance-templates`, { method: "PATCH", token: one.token, body: { enabled: false } });
    expect((await request(`${one.base}/templates`, { method: "GET", token: one.token })).status).toBe(409);
  });
});

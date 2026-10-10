import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Switching a plugin off must mean off on the server too, not just a hidden button: its endpoints answer 409, its
 * background work skips the workspace — and no data is touched (switching it back on restores everything).
 */
describe("Plugin gates (server side of plugins)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `plugin-gates-${runId}`;

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
    const response = await request<{ accessToken: string }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    const token = response.data.accessToken;
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token });
    const ws = workspaces.data[0]!.id;
    const setPlugin = (id: string, enabled: boolean) => request(`/workspaces/${ws}/plugins/${id}`, { method: "PATCH", token, body: { enabled } });
    return { token, ws, setPlugin, get: (path: string) => request(`/workspaces/${ws}${path}`, { method: "GET", token }) };
  }

  it("an endpoint of a plugin that is off answers 409; turning it back on restores it, data untouched", async () => {
    const { token, ws, setPlugin, get } = await setup("gates");
    const account = await request<{ id: string }>(`/workspaces/${ws}/finance/accounts`, { method: "POST", token, body: { name: "Карта", startingBalance: 0 } });
    const task = await request<{ id: string }>(`/workspaces/${ws}/tasks`, { method: "POST", token, body: { title: "Задача" } });

    // On by default: all of these work.
    expect((await get("/finance/obligations")).status).toBe(200);
    expect((await get("/finance/budgets")).status).toBe(200);
    expect((await get("/finance/goals")).status).toBe(200);
    expect((await get("/calendar-connections")).status).toBe(200);
    expect((await get("/tasks/views")).status).toBe(200);
    expect((await get(`/tasks/${task.data.id}/comments`)).status).toBe(200);

    const created = await request(`/workspaces/${ws}/tasks/${task.data.id}/comments`, { method: "POST", token, body: { body: "Первый" } });
    expect(created.status).toBe(201);

    for (const id of ["finance-obligations", "finance-budgeting", "finance-goals", "calendar-external", "tasks-saved-views", "tasks-comments", "finance-import"]) {
      expect((await setPlugin(id, false)).status).toBe(200);
    }
    expect((await get("/finance/obligations")).status).toBe(409);
    expect((await get("/finance/budgets")).status).toBe(409);
    expect((await get("/finance/goals")).status).toBe(409);
    expect((await get("/calendar-connections")).status).toBe(409);
    expect((await get("/tasks/views")).status).toBe(409);
    expect((await get(`/tasks/${task.data.id}/comments`)).status).toBe(409);
    const imp = await request(`/workspaces/${ws}/finance/transactions/import`, {
      method: "POST",
      token,
      body: { accountId: account.data.id, dryRun: true, rows: [{ ref: "r", occurredAt: "2026-03-05T09:00:00.000Z", type: "expense", amount: 100, note: "" }] }
    });
    expect(imp.status).toBe(409);

    // The rest of the module is untouched by the gates.
    expect((await get("/finance/transactions")).status).toBe(200);
    expect((await get("/finance/reports/monthly?months=3")).status).toBe(200);

    for (const id of ["finance-obligations", "finance-budgeting", "finance-goals", "calendar-external", "tasks-saved-views", "tasks-comments", "finance-import"]) {
      await setPlugin(id, true);
    }
    const comments = await get(`/tasks/${task.data.id}/comments`);
    expect(comments.status).toBe(200);
    expect(JSON.stringify(comments.data)).toContain("Первый");
  });

  it("the outgoing calendar feed stops with calendar-external and resumes with it", async () => {
    const { token, ws, setPlugin } = await setup("feed");
    const link = await request<{ url: string }>(`/workspaces/${ws}/calendar/feed`, { method: "GET", token });
    const tokenPart = new URL(link.data.url).pathname.split("/").pop()!.replace(/.ics$/, "");
    const fetchFeed = async () => (await fetch(`${baseUrl}/calendar/${tokenPart}.ics`)).status;
    expect(await fetchFeed()).toBe(200);
    await setPlugin("calendar-external", false);
    expect(await fetchFeed()).toBe(404);
    await setPlugin("calendar-external", true);
    expect(await fetchFeed()).toBe(200);
  });
});

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface RegisteredSession {
  accessToken: string;
  user: { id: string; name: string };
  email: string;
  workspaceId: string;
}

describe("Merged activity feed", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `activity-${runId}`;

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

  it("лента склеивает изменения задач, комментарии и вызовы агента; чужое пространство её не видит", async () => {
    const alice = await register("alice");
    const mallory = await register("mallory");
    const ws = `/workspaces/${alice.workspaceId}`;

    const task = await request<{ id: string }>(`${ws}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Релиз" } });
    await request(`${ws}/tasks/${task.data.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "done" } });
    await request(`${ws}/tasks/${task.data.id}/comments`, { method: "POST", token: alice.accessToken, body: { body: "готово" } });

    const created = await request<{ secret: string }>(`${ws}/agent-tokens`, {
      method: "POST", token: alice.accessToken, body: { name: "Claude", scopes: ["tasks:read"], expiresInDays: 7 }
    });
    await request("/ai/v1/tasks", { method: "GET", token: created.data.secret });
    await request("/ai/v1/notes", { method: "GET", token: created.data.secret }); // refused: no scope

    const feed = await request<Array<{ kind: string; actorKind: string; actorName: string; summary: string; entity: { title: string } | null }>>(
      `${ws}/activity`, { method: "GET", token: alice.accessToken }
    );
    expect(feed.status).toBe(200);
    const kinds = new Set(feed.data.map((e) => e.kind));
    expect(kinds).toEqual(new Set(["task_change", "task_comment", "agent_call"]));
    const change = feed.data.find((e) => e.kind === "task_change");
    expect(change?.summary).toContain("Готово");
    expect(change?.entity?.title).toBe("Релиз");
    expect(feed.data.some((e) => e.actorKind === "agent" && e.actorName === "Claude" && e.summary.startsWith("Попытка"))).toBe(true);
    // Newest first.
    const times = feed.data.map((e) => (e as unknown as { at: string }).at);
    expect([...times].sort().reverse()).toEqual(times);

    const foreign = await request(`${ws}/activity`, { method: "GET", token: mallory.accessToken });
    expect([403, 404]).toContain(foreign.status);
  });

  async function register(name: string): Promise<RegisteredSession> {
    const email = `${emailPrefix}-${name}@example.test`;
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    expect(workspaces.status).toBe(200);
    return { accessToken: response.data.accessToken, user: { ...response.data.user, name }, email, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(
    path: string,
    options: { method: string; token?: string; body?: unknown }
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }
});

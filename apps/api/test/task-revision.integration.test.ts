import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Optimistic concurrency for tasks: a detail-pane save sends `expectedRevision`; a stale one is a 409
 * carrying the current copy, while writers that send nothing (board drag) keep last-write-wins but
 * still bump the revision so an open pane notices.
 */
describe("Task revision / CAS", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `task-revision-${runId}`;

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

  type TaskDto = { id: string; revision: number; title: string; description: string };

  it("a save based on the current revision wins and bumps it; a stale one is a 409 with the current copy", async () => {
    const alice = await register("cas");
    const base = `/workspaces/${alice.workspaceId}/tasks`;
    const created = await request<TaskDto>(base, { method: "POST", token: alice.accessToken, body: { title: "Задача" } });
    expect(created.status).toBe(201);
    expect(created.data.revision).toBe(1);

    const first = await request<TaskDto>(`${base}/${created.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { title: "Первая правка", expectedRevision: 1 }
    });
    expect(first.status).toBe(200);
    expect(first.data.revision).toBe(2);

    // Someone else still holds revision 1.
    const stale = await request<{ code: string; currentRevision: number; current: TaskDto }>(`${base}/${created.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { title: "Устаревшая правка", expectedRevision: 1 }
    });
    expect(stale.status).toBe(409);
    expect(stale.data.code).toBe("task_revision_conflict");
    expect(stale.data.currentRevision).toBe(2);
    expect(stale.data.current.title).toBe("Первая правка");

    // The losing write changed nothing.
    const list = await request<TaskDto[]>(base, { method: "GET", token: alice.accessToken });
    expect(list.data.find((t) => t.id === created.data.id)?.title).toBe("Первая правка");
  });

  it("a write without expectedRevision still goes through and bumps the revision", async () => {
    const alice = await register("lww");
    const base = `/workspaces/${alice.workspaceId}/tasks`;
    const created = await request<TaskDto>(base, { method: "POST", token: alice.accessToken, body: { title: "Доска" } });
    const moved = await request<TaskDto>(`${base}/${created.data.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "in_progress" } });
    expect(moved.status).toBe(200);
    expect(moved.data.revision).toBe(2);
    // A pane that opened at revision 1 now gets told.
    const stale = await request(`${base}/${created.data.id}`, { method: "PATCH", token: alice.accessToken, body: { description: "x", expectedRevision: 1 } });
    expect(stale.status).toBe(409);
  });
});

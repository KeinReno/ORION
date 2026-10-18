import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface Session {
  accessToken: string;
  email: string;
  workspaceId: string;
}

/** G12: @RequirePermission на пилотных маршрутах задач — токен агента без scope получает 403, со scope проходит, человек проходит. */
describe("Permission API pilot (tasks)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `permission-${runId}`;

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

  it("агент без tasks:write получает 403 permission_denied на создании и менять не может; со scope — проходит; человек проходит", async () => {
    const alice = await register("alice");
    const readOnly = await issue(alice, ["tasks:read"]);
    const writer = await issue(alice, ["tasks:read", "tasks:write"]);

    const denied = await request<{ code?: string; permission?: string }>("/ai/v1/tasks", { method: "POST", token: readOnly.secret, body: { title: "Нельзя" } });
    expect(denied.status).toBe(403);
    expect(denied.data).toMatchObject({ code: "permission_denied", permission: "tasks.task.create" });

    const ok = await request<{ id: string }>("/ai/v1/tasks", { method: "POST", token: writer.secret, body: { title: "Можно" } });
    expect(ok.status).toBe(201);

    const patchDenied = await request(`/ai/v1/tasks/${ok.data.id}`, { method: "PATCH", token: readOnly.secret, body: { title: "x" } });
    expect(patchDenied.status).toBe(403);

    const listed = await request<Array<{ title: string }>>("/ai/v1/tasks", { method: "GET", token: readOnly.secret });
    expect(listed.status).toBe(200);
    expect(listed.data.map((t) => t.title)).toContain("Можно");

    const noRead = await issue(alice, ["notes:read"]);
    expect((await request("/ai/v1/tasks", { method: "GET", token: noRead.secret })).status).toBe(403);

    const human = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "От человека" } });
    expect(human.status).toBe(201);
    const humanList = await request<unknown[]>(`/workspaces/${alice.workspaceId}/tasks`, { method: "GET", token: alice.accessToken });
    expect(humanList.status).toBe(200);
    const humanPatch = await request(`/workspaces/${alice.workspaceId}/tasks/${human.data.id}`, { method: "PATCH", token: alice.accessToken, body: { title: "Правка" } });
    expect(humanPatch.status).toBe(200);
  });

  it("отказ по разрешению пишется в журнал токена", async () => {
    const alice = await register("audit");
    const readOnly = await issue(alice, ["tasks:read"]);
    await request("/ai/v1/tasks", { method: "POST", token: readOnly.secret, body: { title: "Нельзя" } });
    const audit = await prisma.asSystem((tx) => tx.agentAuditEntry.findMany({ where: { tokenId: readOnly.id, status: 403 }, select: { action: true } }));
    expect(audit.map((a) => a.action)).toContain("permission:tasks.task.create");
  });

  async function issue(owner: Session, scopes: string[]): Promise<{ id: string; secret: string }> {
    const created = await request<{ id: string; secret: string }>(`/workspaces/${owner.workspaceId}/agent-tokens`, {
      method: "POST",
      token: owner.accessToken,
      body: { name: "Claude", scopes, expiresInDays: 30 }
    });
    expect(created.status).toBe(201);
    return created.data;
  }

  async function createProject(owner: Session, name: string): Promise<{ id: string }> {
    const response = await request<{ id: string }>(`/workspaces/${owner.workspaceId}/projects`, { method: "POST", token: owner.accessToken, body: { name } });
    expect(response.status).toBe(201);
    return response.data;
  }

  async function register(name: string): Promise<Session> {
    const email = `${emailPrefix}-${name}@example.test`;
    const response = await request<{ accessToken: string }>("/auth/register", { method: "POST", body: { email, password: "integration-password-123", name } });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { accessToken: response.data.accessToken, email, workspaceId: workspaces.data[0]!.id };
  }

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }
});

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

describe("Project logbook and directed project relations", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `project-logbook-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) await prisma.asSystem(async (tx) => {
      const users = await tx.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true } });
      if (!users.length) return;
      const userIds = users.map((user) => user.id);
      const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
      await tx.workspace.deleteMany({ where: { id: { in: [...new Set(memberships.map((row) => row.workspaceId))] } } });
    });
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
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST", body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { ...response.data, workspaceId: workspaces.data[0].id };
  }

  async function project(workspaceId: string, token: string, name: string): Promise<string> {
    const response = await request<{ id: string }>(`/workspaces/${workspaceId}/projects`, { method: "POST", token, body: { name } });
    expect(response.status).toBe(201);
    return response.data.id;
  }

  it("keeps a task as a live reference and stores the comment only on the journal link", async () => {
    const alice = await register("entries");
    const qa2 = await project(alice.workspaceId, alice.accessToken, "QA-v2");
    const qa3 = await project(alice.workspaceId, alice.accessToken, "QA-v3");
    const task = await prisma.asSystem((tx) => tx.task.create({ data: { workspaceId: alice.workspaceId, projectId: qa2, title: "Проверить восстановление", description: "Исходное описание" } }));
    const endpoint = `/workspaces/${alice.workspaceId}/projects/${qa3}/logbook`;

    expect((await request(endpoint, { method: "POST", token: alice.accessToken, body: { kind: "decision", text: "spoof", authorId: "spoof" } })).status).toBe(400);
    const created = await request<{ id: string; authorId: string; tasks: Array<{ id: string; projectName: string; comment: string }> }>(endpoint, {
      method: "POST", token: alice.accessToken,
      body: { kind: "decision", text: "Берём проверку в текущий цикл", tasks: [{ taskId: task.id, comment: "Нужна проверка на чистом профиле" }] }
    });
    expect(created.status).toBe(201);
    expect(created.data.authorId).toBe(alice.user.id);
    expect(created.data.tasks).toEqual([{ id: task.id, title: task.title, status: task.status, projectId: qa2, projectName: "QA-v2", comment: "Нужна проверка на чистом профиле", url: null }]);

    const after = await prisma.asSystem((tx) => tx.task.findUniqueOrThrow({ where: { id: task.id } }));
    expect(after).toMatchObject({ title: "Проверить восстановление", description: "Исходное описание", projectId: qa2 });
    expect((await request<Array<{ id: string }>>(endpoint, { method: "GET", token: alice.accessToken })).data.map((row) => row.id)).toContain(created.data.id);
    expect((await request(endpoint, { method: "POST", token: alice.accessToken, body: { kind: "observation", text: "x", tasks: [{ taskId: task.id }, { taskId: task.id }] } })).status).toBe(400);
  });

  it("stores directed relationships once and exposes them from both project pages", async () => {
    const alice = await register("relations");
    const qa2 = await project(alice.workspaceId, alice.accessToken, "QA-v2");
    const qa3 = await project(alice.workspaceId, alice.accessToken, "QA-v3");
    const from = `/workspaces/${alice.workspaceId}/projects/${qa3}/relations`;
    const to = `/workspaces/${alice.workspaceId}/projects/${qa2}/relations`;
    const created = await request<{ id: string; type: string; fromProjectName: string; toProjectName: string }>(from, {
      method: "POST", token: alice.accessToken, body: { type: "continues", toProjectId: qa2 }
    });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ type: "continues", fromProjectName: "QA-v3", toProjectName: "QA-v2" });
    expect((await request<Array<{ id: string }>>(to, { method: "GET", token: alice.accessToken })).data.map((item) => item.id)).toContain(created.data.id);
    const related = await request<{ id: string }>(from, { method: "POST", token: alice.accessToken, body: { type: "related", toProjectId: qa2 } });
    expect(related.status).toBe(201);
    expect((await request(to, { method: "POST", token: alice.accessToken, body: { type: "related", toProjectId: qa3 } })).status).toBe(409);
    expect((await request(`${to}/${related.data.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
    expect((await request(from, { method: "POST", token: alice.accessToken, body: { type: "continues", toProjectId: qa2 } })).status).toBe(409);
    expect((await request(`${from}/${created.data.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
    expect((await request(from, { method: "GET", token: alice.accessToken })).data).toEqual([]);
  });

  it("rejects task and project references from another workspace", async () => {
    const alice = await register("source");
    const bob = await register("target");
    const ownProject = await project(alice.workspaceId, alice.accessToken, "Свой проект");
    const foreignProject = await project(bob.workspaceId, bob.accessToken, "Чужой проект");
    const task = await prisma.asSystem((tx) => tx.task.create({ data: { workspaceId: bob.workspaceId, projectId: foreignProject, title: "Закрытая задача" } }));
    expect((await request(`/workspaces/${alice.workspaceId}/projects/${ownProject}/logbook`, { method: "POST", token: alice.accessToken, body: { kind: "observation", text: "ссылка", tasks: [{ taskId: task.id }] } })).status).toBe(404);
    expect((await request(`/workspaces/${alice.workspaceId}/projects/${ownProject}/relations`, { method: "POST", token: alice.accessToken, body: { type: "depends_on", toProjectId: foreignProject } })).status).toBe(404);
  });
});

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

/** Идеи и Проблемы проекта: изоляция, вид, одно «Сделать задачей», каскад. */
describe("Project captures (ideas / problems)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `cap-${runId}`;

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

  async function setup(name: string) {
    const alice = await register(name);
    const project = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/projects`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "KAIDEN" }
    });
    expect(project.status).toBe(201);
    return { alice, base: `/workspaces/${alice.workspaceId}/projects/${project.data.id}`, projectId: project.data.id };
  }

  it("создаёт идею и проблему, виды не смешиваются", async () => {
    const { alice, base } = await setup("kinds");
    const idea = await request<{ id: string; severity: string | null }>(`${base}/ideas`, {
      method: "POST", token: alice.accessToken, body: { title: "Тёмная тема" }
    });
    expect(idea.status).toBe(201);
    expect(idea.data.severity).toBeNull();
    const problem = await request<{ id: string; severity: string }>(`${base}/problems`, {
      method: "POST", token: alice.accessToken, body: { title: "Падает экспорт", severity: "bug" }
    });
    expect(problem.status).toBe(201);
    expect(problem.data.severity).toBe("bug");

    const ideas = await request<Array<{ id: string }>>(`${base}/ideas`, { method: "GET", token: alice.accessToken });
    expect(ideas.data.map((i) => i.id)).toEqual([idea.data.id]);
    const wrong = await request(`${base}/problems/${idea.data.id}`, {
      method: "PATCH", token: alice.accessToken, body: { title: "x" }
    });
    expect(wrong.status).toBe(404);
  });

  it("«Сделать задачей» создаёт ровно одну задачу, даже при гонке; закрытую нельзя", async () => {
    const { alice, base, projectId } = await setup("promote");
    const idea = await request<{ id: string }>(`${base}/ideas`, {
      method: "POST", token: alice.accessToken, body: { title: "Экспорт в PDF", body: "описание" }
    });
    const results = await Promise.all(
      [1, 2, 3].map(() => request<{ taskId: string; status: string }>(`${base}/ideas/${idea.data.id}/promote`, { method: "POST", token: alice.accessToken }))
    );
    for (const r of results) expect([200, 201]).toContain(r.status);
    const taskIds = new Set(results.map((r) => r.data.taskId));
    expect(taskIds.size).toBe(1);
    const tasks = await request<Array<{ id: string; title: string; projectId: string | null }>>(
      `/workspaces/${alice.workspaceId}/tasks`, { method: "GET", token: alice.accessToken }
    );
    const created = tasks.data.filter((t) => t.title === "Экспорт в PDF");
    expect(created).toHaveLength(1);
    expect(created[0].projectId).toBe(projectId);

    const dismissed = await request<{ id: string }>(`${base}/ideas`, {
      method: "POST", token: alice.accessToken, body: { title: "Устарело" }
    });
    await request(`${base}/ideas/${dismissed.data.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "dismissed" } });
    const refused = await request(`${base}/ideas/${dismissed.data.id}/promote`, { method: "POST", token: alice.accessToken });
    expect(refused.status).toBe(400);
  });

  it("чужой пользователь получает отказ, запись удаляется вместе с проектом", async () => {
    const { alice, base, projectId } = await setup("iso");
    const mallory = await register("mallory");
    const idea = await request<{ id: string }>(`${base}/ideas`, {
      method: "POST", token: alice.accessToken, body: { title: "Секрет" }
    });
    const denied = await request(`${base}/ideas`, { method: "GET", token: mallory.accessToken });
    expect([403, 404]).toContain(denied.status);
    const crossWorkspace = await request(
      `/workspaces/${mallory.workspaceId}/projects/${projectId}/ideas`, { method: "GET", token: mallory.accessToken }
    );
    expect(crossWorkspace.status).toBe(404);

    await prisma.asSystem((tx) => tx.project.delete({ where: { id: projectId } }));
    const left = await prisma.asSystem((tx) => tx.projectCapture.count({ where: { id: idea.data.id } }));
    expect(left).toBe(0);
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

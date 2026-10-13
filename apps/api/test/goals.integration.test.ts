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

describe("Global goals over projects", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `goals-${runId}`;

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

  async function project(owner: RegisteredSession, name: string) {
    const created = await request<{ id: string }>(`/workspaces/${owner.workspaceId}/projects`, {
      method: "POST", token: owner.accessToken, body: { name }
    });
    expect(created.status).toBe(201);
    return created.data.id;
  }

  async function task(owner: RegisteredSession, projectId: string, title: string, status?: string) {
    const created = await request<{ id: string }>(`/workspaces/${owner.workspaceId}/tasks`, {
      method: "POST", token: owner.accessToken, body: { title, projectId }
    });
    expect(created.status).toBe(201);
    if (status) {
      const patched = await request(`/workspaces/${owner.workspaceId}/tasks/${created.data.id}`, {
        method: "PATCH", token: owner.accessToken, body: { status }
      });
      expect(patched.status).toBe(200);
    }
  }

  it("прогресс цели считается по задачам планов с весами; план без задач — «неизвестен», а не 0", async () => {
    const alice = await register("alice");
    const base = `/workspaces/${alice.workspaceId}/goals`;
    const goal = await request<{ id: string }>(base, { method: "POST", token: alice.accessToken, body: { title: "Запустить экосистему" } });
    expect(goal.status).toBe(201);

    const p1 = await project(alice, "Сайт");
    const p2 = await project(alice, "Бот");
    const p3 = await project(alice, "Пустой");
    await task(alice, p1, "a", "done");
    await task(alice, p1, "b", "done"); // 100 %
    await task(alice, p2, "c");
    await task(alice, p2, "d"); // 0 %

    for (const [projectId, weight] of [[p1, 3], [p2, 1], [p3, 5]] as const) {
      const added = await request(`${base}/${goal.data.id}/plans`, { method: "POST", token: alice.accessToken, body: { projectId, weight } });
      expect(added.status).toBe(201);
    }
    const dup = await request(`${base}/${goal.data.id}/plans`, { method: "POST", token: alice.accessToken, body: { projectId: p1 } });
    expect(dup.status).toBe(409);

    const list = await request<Array<{ progress: number | null; unknownPlans: number; plans: Array<{ projectName: string; progress: number | null }> }>>(
      base, { method: "GET", token: alice.accessToken }
    );
    expect(list.data).toHaveLength(1);
    expect(list.data[0].progress).toBe(75); // (3*100 + 1*0) / 4
    expect(list.data[0].unknownPlans).toBe(1);
    expect(list.data[0].plans.find((p) => p.projectName === "Пустой")?.progress).toBeNull();
  });

  it("чужой проект и чужая цель недоступны; удаление проекта убирает только связь", async () => {
    const alice = await register("alice2");
    const mallory = await register("mallory");
    const goal = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/goals`, {
      method: "POST", token: alice.accessToken, body: { title: "Цель" }
    });
    const foreignProject = await project(mallory, "Чужой");
    const mix = await request(`/workspaces/${alice.workspaceId}/goals/${goal.data.id}/plans`, {
      method: "POST", token: alice.accessToken, body: { projectId: foreignProject }
    });
    expect(mix.status).toBe(404);

    const denied = await request(`/workspaces/${alice.workspaceId}/goals`, { method: "GET", token: mallory.accessToken });
    expect([403, 404]).toContain(denied.status);

    const own = await project(alice, "Свой");
    await request(`/workspaces/${alice.workspaceId}/goals/${goal.data.id}/plans`, { method: "POST", token: alice.accessToken, body: { projectId: own } });
    await prisma.asSystem((tx) => tx.project.delete({ where: { id: own } }));
    const after = await request<Array<{ id: string; plans: unknown[] }>>(`/workspaces/${alice.workspaceId}/goals`, { method: "GET", token: alice.accessToken });
    expect(after.data.find((g) => g.id === goal.data.id)?.plans).toEqual([]);
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

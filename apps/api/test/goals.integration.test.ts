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

  it("подцели: вложенность до 3 уровней, циклы и чужие родители отклоняются, прогресс родителя смешивает планы и подцели", async () => {
    const alice = await register("nest");
    const mallory = await register("nest-mallory");
    const base = `/workspaces/${alice.workspaceId}/goals`;
    const mk = async (title: string, extra: Record<string, unknown> = {}) =>
      request<{ id: string; parentId: string | null; progress: number | null; subGoalCount: number; unknownSubGoals: number }>(base, {
        method: "POST", token: alice.accessToken, body: { title, ...extra }
      });
    const patch = (id: string, body: Record<string, unknown>) =>
      request<{ id: string; parentId: string | null; progress: number | null }>(`${base}/${id}`, { method: "PATCH", token: alice.accessToken, body });
    const get = async (id: string) =>
      (await request<Array<{ id: string; parentId: string | null; progress: number | null; subGoalCount: number; unknownSubGoals: number }>>(base, { method: "GET", token: alice.accessToken })).data.find((g) => g.id === id);

    const root = (await mk("Корень")).data;
    const mid = await mk("Середина", { parentId: root.id });
    expect(mid.status).toBe(201);
    const leaf = await mk("Лист", { parentId: mid.data.id });
    expect(leaf.status).toBe(201);
    // 4-й уровень
    expect((await mk("Слишком глубоко", { parentId: leaf.data.id })).status).toBe(400);
    // цикл и самоссылка
    expect((await patch(root.id, { parentId: leaf.data.id })).status).toBe(400);
    expect((await patch(root.id, { parentId: root.id })).status).toBe(400);
    // перенос поддерева, выходящий за глубину
    const other = (await mk("Другая")).data;
    expect((await patch(other.id, { parentId: leaf.data.id })).status).toBe(400);
    // чужое пространство
    const foreign = await request<{ id: string }>(`/workspaces/${mallory.workspaceId}/goals`, {
      method: "POST", token: mallory.accessToken, body: { title: "Чужая" }
    });
    expect((await mk("Смешение", { parentId: foreign.data.id })).status).toBe(404);
    expect((await patch(other.id, { parentId: foreign.data.id })).status).toBe(404);

    // без известного прогресса — null, не 0
    expect((await get(root.id))?.progress).toBeNull();
    expect((await get(root.id))?.subGoalCount).toBe(1);

    // лист: проект 100 %; середина: свой план 0 % с весом 1 + лист (вес 3)
    const done = await project(alice, "Готовый");
    await task(alice, done, "a", "done");
    const zero = await project(alice, "Нулевой");
    await task(alice, zero, "b");
    await request(`${base}/${leaf.data.id}/plans`, { method: "POST", token: alice.accessToken, body: { projectId: done } });
    await request(`${base}/${mid.data.id}/plans`, { method: "POST", token: alice.accessToken, body: { projectId: zero, weight: 1 } });
    expect((await patch(leaf.data.id, { subWeight: 3 })).status).toBe(200);
    expect((await get(leaf.data.id))?.progress).toBe(100);
    expect((await get(mid.data.id))?.progress).toBe(75); // (1*0 + 3*100) / 4
    expect((await get(root.id))?.progress).toBe(75); // единственная известная подцель

    // подцель без прогресса не тянет родителя вниз
    const empty = await mk("Пустая", { parentId: root.id });
    const rootAfter = await get(root.id);
    expect(rootAfter?.progress).toBe(75);
    expect(rootAfter?.unknownSubGoals).toBe(1);
    expect((await get(empty.data.id))?.progress).toBeNull();

    // перенос в корень и обратно
    expect((await patch(empty.data.id, { parentId: null })).data.parentId).toBeNull();

    // удаление родителя: дети становятся верхнего уровня, не удаляются
    const del = await request(`${base}/${mid.data.id}`, { method: "DELETE", token: alice.accessToken });
    expect(del.status).toBe(204);
    const orphan = await get(leaf.data.id);
    expect(orphan).toBeDefined();
    expect(orphan?.parentId).toBeNull();
    expect((await get(root.id))?.subGoalCount).toBe(0);
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

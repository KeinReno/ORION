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

type Entry = {
  entityType: "goal" | "project" | "task" | "milestone" | "material";
  entityId: string;
  x: number;
  y: number;
  dirty?: boolean;
  broken?: boolean;
  updatedAt: string;
};

type LayoutResponse = {
  layout: { entries: Entry[]; revision: number; zones: Array<{ name: string; entityIds: string[] }>; viewport: { x: number; y: number; zoom: number } };
  conflicts: Array<{ entityId: string; reason: string; client: Entry; server: Entry }>;
};

describe("08 — constellation canvas (layout, graph, auto-layout, progress)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `goals-canvas-${runId}`;

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
        const userIds = users.map((user) => user.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        const workspaceIds = [...new Set(memberships.map((membership) => membership.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      });
    }
    await app?.close();
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
    return {
      accessToken: response.data.accessToken,
      user: { ...response.data.user, name },
      email,
      workspaceId: workspaces.data[0]!.id
    };
  }

  async function request<T = unknown>(
    path: string,
    options: { method: string; token?: string; body?: unknown; headers?: Record<string, string> }
  ): Promise<{ status: number; data: T; headers: Headers }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.headers ?? {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data, headers: response.headers };
  }

  async function makeGoal(session: RegisteredSession, title: string, extra: Record<string, unknown> = {}) {
    const created = await request<{ id: string }>(`/workspaces/${session.workspaceId}/goals`, {
      method: "POST",
      token: session.accessToken,
      body: { title, ...extra }
    });
    expect(created.status).toBe(201);
    return created.data.id;
  }

  async function makeProject(session: RegisteredSession, name: string) {
    const created = await request<{ id: string }>(`/workspaces/${session.workspaceId}/projects`, {
      method: "POST",
      token: session.accessToken,
      body: { name }
    });
    expect(created.status).toBe(201);
    return created.data.id;
  }

  async function makeTask(session: RegisteredSession, projectId: string, title: string, status?: string) {
    const created = await request<{ id: string }>(`/workspaces/${session.workspaceId}/tasks`, {
      method: "POST",
      token: session.accessToken,
      body: { title, projectId }
    });
    expect(created.status).toBe(201);
    if (status) {
      const patched = await request(`/workspaces/${session.workspaceId}/tasks/${created.data.id}`, {
        method: "PATCH",
        token: session.accessToken,
        body: { status }
      });
      expect(patched.status).toBe(200);
    }
    return created.data.id;
  }

  const layoutPath = (session: RegisteredSession, goalId: string) =>
    `/workspaces/${session.workspaceId}/goals/${goalId}/canvas-layout`;

  it("8.1 partial PUT: правки разных нод двух клиентов обе выживают, конфликт одной ноды возвращает обе версии", async () => {
    const alice = await register("merge");
    const goalId = await makeGoal(alice, "Раскладка");
    const projectId = await makeProject(alice, "Карта");
    const first = await makeTask(alice, projectId, "Первая");
    const second = await makeTask(alice, projectId, "Вторая");

    const t0 = "2026-11-11T08:00:00.000Z";
    const t1 = "2026-11-11T09:00:00.000Z";
    const t2 = "2026-11-11T09:05:00.000Z";
    const t3 = "2026-11-11T09:10:00.000Z";

    // Клиент A ставит первую задачу.
    const a = await request<LayoutResponse>(layoutPath(alice, goalId), {
      method: "PUT",
      token: alice.accessToken,
      body: { entries: [{ entityType: "task", entityId: first, x: 100, y: 120, updatedAt: t1 }] }
    });
    expect(a.status).toBe(200);
    const revision = a.data.layout.revision;
    expect(a.headers.get("etag")).toBe(`"${revision}"`);

    // Клиент B независимо ставит вторую — правка A сохраняется.
    const b = await request<LayoutResponse>(layoutPath(alice, goalId), {
      method: "PUT",
      token: alice.accessToken,
      body: { entries: [{ entityType: "task", entityId: second, x: 200, y: 240, updatedAt: t2 }] }
    });
    expect(b.status).toBe(200);
    expect(b.data.layout.entries.map((entry) => [entry.entityId, entry.x, entry.y]).sort()).toEqual(
      [
        [first, 100, 120],
        [second, 200, 240]
      ].sort()
    );

    // Устаревшая правка той же ноды не затирает свежую: обе версии в conflicts.
    const stale = await request<LayoutResponse>(layoutPath(alice, goalId), {
      method: "PUT",
      token: alice.accessToken,
      body: { entries: [{ entityType: "task", entityId: first, x: 999, y: 999, updatedAt: t0 }] }
    });
    expect(stale.status).toBe(200);
    expect(stale.data.layout.entries.find((entry) => entry.entityId === first)).toMatchObject({ x: 100, y: 120 });
    expect(stale.data.conflicts).toHaveLength(1);
    expect(stale.data.conflicts[0]).toMatchObject({
      entityId: first,
      reason: "stale",
      client: { x: 999, y: 999 },
      server: { x: 100, y: 120 }
    });

    // Свежая правка разрешает конфликт и применяется.
    const resolved = await request<LayoutResponse>(layoutPath(alice, goalId), {
      method: "PUT",
      token: alice.accessToken,
      body: { entries: [{ entityType: "task", entityId: first, x: 300, y: 360, updatedAt: t3 }] }
    });
    expect(resolved.status).toBe(200);
    expect(resolved.data.layout.entries.find((entry) => entry.entityId === first)).toMatchObject({ x: 300, y: 360 });
    expect(resolved.data.conflicts).toEqual([]);
  });

  it("8.1 If-Match: полная замена только с текущей ревизией, иначе 412; зоны сохраняют порядок", async () => {
    const alice = await register("etag");
    const goalId = await makeGoal(alice, "ETag");
    const first = await makeTask(alice, await makeProject(alice, "Проект"), "Нода");

    const created = await request<LayoutResponse>(layoutPath(alice, goalId), {
      method: "PUT",
      token: alice.accessToken,
      body: {
        entries: [{ entityType: "task", entityId: first, x: 10, y: 20, updatedAt: "2026-11-11T09:00:00.000Z" }],
        zones: [{ name: "Этап 1", color: "#123456", entityIds: [first] }]
      }
    });
    expect(created.status).toBe(200);
    expect(created.data.layout.zones.map((zone) => zone.name)).toEqual(["Этап 1"]);

    const noHeader = await request(layoutPath(alice, goalId), {
      method: "PUT",
      token: alice.accessToken,
      body: { replace: true, entries: [] }
    });
    expect(noHeader.status).toBe(428);

    const wrong = await request(layoutPath(alice, goalId), {
      method: "PUT",
      token: alice.accessToken,
      headers: { "If-Match": '"999"' },
      body: { replace: true, entries: [] }
    });
    expect(wrong.status).toBe(412);

    const replaced = await request<LayoutResponse>(layoutPath(alice, goalId), {
      method: "PUT",
      token: alice.accessToken,
      headers: { "If-Match": `"${created.data.layout.revision}"` },
      body: { replace: true, entries: [] }
    });
    expect(replaced.status).toBe(200);
    expect(replaced.data.layout.entries).toEqual([]);
    expect(replaced.data.layout.revision).toBe(created.data.layout.revision + 1);
  });

  it("8.1 битая ссылка помечается broken при чтении, строка раскладки не удаляется", async () => {
    const alice = await register("broken");
    const goalId = await makeGoal(alice, "Битая ссылка");
    await request(layoutPath(alice, goalId), {
      method: "PUT",
      token: alice.accessToken,
      body: { entries: [{ entityType: "task", entityId: "missing-task", x: 1, y: 2, updatedAt: "2026-11-11T09:00:00.000Z" }] }
    });
    const layout = await request<LayoutResponse>(layoutPath(alice, goalId), { method: "GET", token: alice.accessToken });
    expect(layout.status).toBe(200);
    expect(layout.data.layout.entries[0]).toMatchObject({ entityId: "missing-task", broken: true });

    const graph = await request<{ nodes: Array<{ entityId: string; broken: boolean }> }>(
      `/workspaces/${alice.workspaceId}/goals/${goalId}/graph`,
      { method: "GET", token: alice.accessToken }
    );
    expect(graph.data.nodes.find((node) => node.entityId === "missing-task")?.broken).toBe(true);
  });

  it("8.2 graph: цель, подцель, проект, задачи и ребро depends_on одним запросом", async () => {
    const alice = await register("graph");
    const goalId = await makeGoal(alice, "Корень");
    const subGoalId = await makeGoal(alice, "Подцель", { parentId: goalId });
    const projectId = await makeProject(alice, "План");
    const first = await makeTask(alice, projectId, "Сначала");
    const second = await makeTask(alice, projectId, "Потом");
    await request(`/workspaces/${alice.workspaceId}/goals/${goalId}/plans`, {
      method: "POST",
      token: alice.accessToken,
      body: { projectId }
    });
    // «Потом» зависит от «Сначала»: в графе ребро выходит в семантическом
    // направлении «предпосылка -> зависимый», одинаковом для обоих legacy-видов.
    const link = await request(`/workspaces/${alice.workspaceId}/links`, {
      method: "POST",
      token: alice.accessToken,
      body: { sourceType: "task", sourceId: second, targetType: "task", targetId: first, kind: "depends_on" }
    });
    expect(link.status).toBe(201);

    const graph = await request<{
      rootId: string;
      nodes: Array<{ entityType: string; entityId: string; title: string }>;
      edges: Array<{ kind: string; source: { entityId: string }; target: { entityId: string } }>;
    }>(`/workspaces/${alice.workspaceId}/goals/${goalId}/graph`, { method: "GET", token: alice.accessToken });
    expect(graph.status).toBe(200);
    expect(graph.data.rootId).toBe(goalId);
    const ids = new Set(graph.data.nodes.map((node) => node.entityId));
    for (const id of [goalId, subGoalId, projectId, first, second]) expect(ids.has(id)).toBe(true);
    expect(graph.data.edges).toEqual([
      expect.objectContaining({ kind: "depends_on", source: { entityType: "task", entityId: first }, target: { entityType: "task", entityId: second } })
    ]);
  });

  it("8.3 авто-раскладка: depends_on не нарушен, ручной якорь неподвижен, применение — только PUT", async () => {
    const alice = await register("auto");
    const goalId = await makeGoal(alice, "Авто");
    const projectId = await makeProject(alice, "Слой");
    const first = await makeTask(alice, projectId, "Первый шаг");
    const second = await makeTask(alice, projectId, "Второй шаг");
    await request(`/workspaces/${alice.workspaceId}/goals/${goalId}/plans`, {
      method: "POST",
      token: alice.accessToken,
      body: { projectId }
    });
    // «Второй шаг» зависит от «Первого шага»: первый обязан быть выше.
    await request(`/workspaces/${alice.workspaceId}/links`, {
      method: "POST",
      token: alice.accessToken,
      body: { sourceType: "task", sourceId: second, targetType: "task", targetId: first, kind: "depends_on" }
    });

    // Ручной якорь проекта.
    const anchored = await request<LayoutResponse>(layoutPath(alice, goalId), {
      method: "PUT",
      token: alice.accessToken,
      body: { entries: [{ entityType: "project", entityId: projectId, x: -40, y: 900, dirty: true, updatedAt: "2026-11-11T09:00:00.000Z" }] }
    });
    expect(anchored.status).toBe(200);

    const auto = await request<{ entries: Entry[]; viewport: { zoom: number } }>(
      `/workspaces/${alice.workspaceId}/goals/${goalId}/canvas-layout/auto`,
      { method: "POST", token: alice.accessToken, body: { respectManual: true } }
    );
    expect(auto.status).toBe(200);
    const byId = new Map(auto.data.entries.map((entry) => [entry.entityId, entry]));
    expect(byId.get(projectId)).toMatchObject({ x: -40, y: 900, dirty: true });
    expect(byId.get(second)!.y).toBeGreaterThan(byId.get(first)!.y);
    expect(auto.data.viewport.zoom).toBeGreaterThan(0);

    // Авто-раскладка не применяется сама: сохранённая раскладка всё ещё только якорь.
    const stored = await request<LayoutResponse>(layoutPath(alice, goalId), { method: "GET", token: alice.accessToken });
    expect(stored.data.layout.entries).toHaveLength(1);
  });

  it("8.4 прогресс: итог совпадает с прогрессом цели и проектов, веса этапов сохранены", async () => {
    const alice = await register("progress");
    const goalId = await makeGoal(alice, "Прогресс");
    const projectId = await makeProject(alice, "Дело");
    await makeTask(alice, projectId, "Сделано", "done");
    await makeTask(alice, projectId, "Открыто");
    await request(`/workspaces/${alice.workspaceId}/goals/${goalId}/plans`, {
      method: "POST",
      token: alice.accessToken,
      body: { projectId, weight: 4 }
    });

    const goals = await request<Array<{ id: string; progress: number | null }>>(`/workspaces/${alice.workspaceId}/goals`, {
      method: "GET",
      token: alice.accessToken
    });
    const goal = goals.data.find((item) => item.id === goalId);
    const report = await request<{
      progress: number | null;
      weights: { stage: string };
      stages: Array<{ projectId: string; weight: number; progress: number | null }>;
      projects: Array<{ projectId: string; progress: number | null }>;
      tasks: { total: number; closed: number; open: number };
    }>(`/workspaces/${alice.workspaceId}/goals/${goalId}/progress`, { method: "GET", token: alice.accessToken });

    expect(report.status).toBe(200);
    expect(report.data.progress).toBe(goal?.progress);
    expect(report.data.progress).toBe(50);
    expect(report.data.weights.stage).toBe("plan.weight");
    expect(report.data.stages[0]).toMatchObject({ projectId, weight: 4, progress: 50 });
    expect(report.data.projects[0]).toMatchObject({ projectId, progress: 50 });
    expect(report.data.tasks).toEqual({ total: 2, closed: 1, open: 1 });
  });

  it("8.4 поиск нод: названия и координаты из сохранённой раскладки", async () => {
    const alice = await register("search");
    const goalId = await makeGoal(alice, "Поиск");
    const projectId = await makeProject(alice, "Поисковый проект");
    const task = await makeTask(alice, projectId, "Уникальная звезда");
    await request(`/workspaces/${alice.workspaceId}/goals/${goalId}/plans`, {
      method: "POST",
      token: alice.accessToken,
      body: { projectId }
    });
    await request(layoutPath(alice, goalId), {
      method: "PUT",
      token: alice.accessToken,
      body: { entries: [{ entityType: "task", entityId: task, x: 77, y: 88, updatedAt: "2026-11-11T09:00:00.000Z" }] }
    });

    const found = await request<{ nodes: Array<{ entityId: string; title: string; x: number; y: number }> }>(
      `/workspaces/${alice.workspaceId}/goals/${goalId}/graph/search?q=уникальная`,
      { method: "GET", token: alice.accessToken }
    );
    expect(found.status).toBe(200);
    expect(found.data.nodes).toEqual([expect.objectContaining({ entityId: task, title: "Уникальная звезда", x: 77, y: 88 })]);

    const empty = await request<{ nodes: unknown[] }>(
      `/workspaces/${alice.workspaceId}/goals/${goalId}/graph/search?q=нет-такого`,
      { method: "GET", token: alice.accessToken }
    );
    expect(empty.data.nodes).toEqual([]);
  });

  it("чужое пространство не читает раскладку, граф и прогресс", async () => {
    const alice = await register("scope");
    const mallory = await register("scope-foreign");
    const goalId = await makeGoal(alice, "Секрет");
    const foreign = await request(layoutPath(alice, goalId), { method: "GET", token: mallory.accessToken });
    expect([403, 404]).toContain(foreign.status);
    const graph = await request(`/workspaces/${alice.workspaceId}/goals/${goalId}/graph`, { method: "GET", token: mallory.accessToken });
    expect([403, 404]).toContain(graph.status);
    const progress = await request(`/workspaces/${alice.workspaceId}/goals/${goalId}/progress`, { method: "GET", token: mallory.accessToken });
    expect([403, 404]).toContain(progress.status);
    const otherGoal = await makeGoal(mallory, "Чужая");
    const mix = await request(layoutPath(alice, otherGoal), { method: "GET", token: alice.accessToken });
    expect([403, 404]).toContain(mix.status);
  });
});

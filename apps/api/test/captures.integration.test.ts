import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface RegisteredSession {
  accessToken: string;
  email: string;
  workspaceId: string;
}

interface CaptureDto {
  id: string;
  anchorType: string | null;
  anchorId: string | null;
  kind: string;
  status: string;
  severity: string | null;
  taskId: string | null;
  title: string;
}

/** Универсальный Capture: якорь на любой объект или без него, изоляция, одно «Сделать задачей», совместимость со старыми роутами проекта. */
describe("Universal captures", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `ucap-${runId}`;

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

  async function makeHome(s: RegisteredSession): Promise<string> {
    const home = await request<{ id: string }>(`/workspaces/${s.workspaceId}/homes`, {
      method: "POST", token: s.accessToken, body: { name: "Квартира", kind: "flat", note: "" }
    });
    expect(home.status).toBe(201);
    return home.data.id;
  }

  it("создаёт записи без якоря и с якорем на дом, фильтры не смешивают их", async () => {
    const alice = await register("anchors");
    const homeId = await makeHome(alice);
    const base = `/workspaces/${alice.workspaceId}/captures`;

    const free = await request<CaptureDto>(base, { method: "POST", token: alice.accessToken, body: { kind: "note", title: "Просто мысль" } });
    expect(free.status).toBe(201);
    expect(free.data.anchorType).toBeNull();
    expect(free.data.anchorId).toBeNull();

    const onHome = await request<CaptureDto>(base, {
      method: "POST", token: alice.accessToken,
      body: { kind: "problem", title: "Течёт кран", severity: "bug", anchorType: "home", anchorId: homeId }
    });
    expect(onHome.status).toBe(201);
    expect(onHome.data.severity).toBe("bug");

    const idea = await request<CaptureDto>(base, {
      method: "POST", token: alice.accessToken,
      body: { kind: "idea", title: "Умная розетка", severity: "bug", anchorType: "home", anchorId: homeId }
    });
    expect(idea.data.severity).toBeNull();

    const forHome = await request<CaptureDto[]>(`${base}?anchorType=home&anchorId=${homeId}`, { method: "GET", token: alice.accessToken });
    expect(forHome.data.map((c) => c.id).sort()).toEqual([onHome.data.id, idea.data.id].sort());
    const onlyIdeas = await request<CaptureDto[]>(`${base}?anchorType=home&anchorId=${homeId}&kind=idea`, { method: "GET", token: alice.accessToken });
    expect(onlyIdeas.data.map((c) => c.id)).toEqual([idea.data.id]);
    const unanchored = await request<CaptureDto[]>(`${base}?anchorType=none`, { method: "GET", token: alice.accessToken });
    expect(unanchored.data.map((c) => c.id)).toEqual([free.data.id]);
    const everything = await request<CaptureDto[]>(base, { method: "GET", token: alice.accessToken });
    expect(everything.data).toHaveLength(3);
  });

  it("отвергает половину якоря, неизвестный тип, чужой и несуществующий объект", async () => {
    const alice = await register("bad-anchor");
    const bob = await register("bad-anchor-bob");
    const bobHome = await makeHome(bob);
    const base = `/workspaces/${alice.workspaceId}/captures`;

    const half = await request(base, { method: "POST", token: alice.accessToken, body: { kind: "note", title: "x", anchorType: "home" } });
    expect(half.status).toBe(400);
    const unknown = await request(base, { method: "POST", token: alice.accessToken, body: { kind: "note", title: "x", anchorType: "planet", anchorId: "1" } });
    expect(unknown.status).toBe(400);
    const missing = await request(base, { method: "POST", token: alice.accessToken, body: { kind: "note", title: "x", anchorType: "goal", anchorId: "nope" } });
    expect(missing.status).toBe(404);
    // Дом существует, но в другом пространстве.
    const foreign = await request(base, { method: "POST", token: alice.accessToken, body: { kind: "note", title: "x", anchorType: "home", anchorId: bobHome } });
    expect(foreign.status).toBe(404);
    const foreignList = await request(`${base}?anchorType=home&anchorId=${bobHome}`, { method: "GET", token: alice.accessToken });
    expect(foreignList.status).toBe(404);
  });

  it("«Сделать задачей» создаёт ровно одну задачу, запись остаётся; задача наследует дом", async () => {
    const alice = await register("promote");
    const homeId = await makeHome(alice);
    const base = `/workspaces/${alice.workspaceId}/captures`;
    const item = await request<CaptureDto>(base, {
      method: "POST", token: alice.accessToken,
      body: { kind: "idea", title: "Поменять замок", body: "описание", anchorType: "home", anchorId: homeId }
    });
    const results = await Promise.all(
      [1, 2, 3].map(() => request<CaptureDto>(`${base}/${item.data.id}/promote`, { method: "POST", token: alice.accessToken }))
    );
    for (const r of results) expect([200, 201]).toContain(r.status);
    expect(new Set(results.map((r) => r.data.taskId)).size).toBe(1);
    expect(results[0].data.status).toBe("promoted");

    const tasks = await request<Array<{ id: string; title: string; description: string }>>(
      `/workspaces/${alice.workspaceId}/tasks`, { method: "GET", token: alice.accessToken }
    );
    const created = tasks.data.filter((t) => t.title === "Поменять замок");
    expect(created).toHaveLength(1);
    // DTO задачи homeId не отдаёт — смотрим строку напрямую.
    const row = await prisma.asSystem((tx) => tx.task.findUnique({ where: { id: created[0].id } }));
    expect(row?.homeId).toBe(homeId);
    expect(created[0].description).toBe("описание");

    // Исходная запись не потеряна.
    const still = await request<CaptureDto[]>(`${base}?anchorType=home&anchorId=${homeId}`, { method: "GET", token: alice.accessToken });
    expect(still.data).toHaveLength(1);
    expect(still.data[0].taskId).toBe(results[0].data.taskId);

    const dismissed = await request<CaptureDto>(base, { method: "POST", token: alice.accessToken, body: { kind: "note", title: "Устарело" } });
    await request(`${base}/${dismissed.data.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "dismissed" } });
    const refused = await request(`${base}/${dismissed.data.id}/promote`, { method: "POST", token: alice.accessToken });
    expect(refused.status).toBe(400);
    const byHand = await request(`${base}/${item.data.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "promoted" } });
    expect(byHand.status).toBe(400);
  });

  it("чужой пользователь не видит и не меняет записи; RLS режет и прямой запрос", async () => {
    const alice = await register("iso");
    const mallory = await register("iso-mallory");
    const base = `/workspaces/${alice.workspaceId}/captures`;
    const secret = await request<CaptureDto>(base, { method: "POST", token: alice.accessToken, body: { kind: "note", title: "Секрет" } });

    const denied = await request(base, { method: "GET", token: mallory.accessToken });
    expect([403, 404]).toContain(denied.status);
    const patchDenied = await request(`/workspaces/${mallory.workspaceId}/captures/${secret.data.id}`, {
      method: "PATCH", token: mallory.accessToken, body: { title: "взлом" }
    });
    expect(patchDenied.status).toBe(404);
    const deleteDenied = await request(`/workspaces/${mallory.workspaceId}/captures/${secret.data.id}`, { method: "DELETE", token: mallory.accessToken });
    expect(deleteDenied.status).toBe(404);

    const mallorySees = await prisma.withUser(await userIdOf(mallory), (tx) => tx.capture.count({ where: { id: secret.data.id } }));
    expect(mallorySees).toBe(0);
  });

  it("старые роуты проекта работают поверх Capture, запись удаляется вместе с проектом", async () => {
    const alice = await register("legacy");
    const project = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/projects`, {
      method: "POST", token: alice.accessToken, body: { name: "KAIDEN" }
    });
    const legacy = `/workspaces/${alice.workspaceId}/projects/${project.data.id}`;
    const idea = await request<{ id: string; projectId: string; kind: string }>(`${legacy}/ideas`, {
      method: "POST", token: alice.accessToken, body: { title: "Тёмная тема" }
    });
    expect(idea.status).toBe(201);
    expect(idea.data.projectId).toBe(project.data.id);

    // Та же запись видна через универсальный API с якорем project.
    const universal = await request<CaptureDto[]>(
      `/workspaces/${alice.workspaceId}/captures?anchorType=project&anchorId=${project.data.id}`, { method: "GET", token: alice.accessToken }
    );
    expect(universal.data.map((c) => c.id)).toEqual([idea.data.id]);
    // Новая запись универсального API с якорем-проектом видна в старой «Идее»-вкладке.
    const viaNew = await request<CaptureDto>(`/workspaces/${alice.workspaceId}/captures`, {
      method: "POST", token: alice.accessToken, body: { kind: "idea", title: "Из нового API", anchorType: "project", anchorId: project.data.id }
    });
    const ideas = await request<Array<{ id: string }>>(`${legacy}/ideas`, { method: "GET", token: alice.accessToken });
    expect(ideas.data.map((c) => c.id).sort()).toEqual([idea.data.id, viaNew.data.id].sort());
    // Старый роут «проблем» не отдаёт чужой вид.
    const wrongKind = await request(`${legacy}/problems/${idea.data.id}`, { method: "PATCH", token: alice.accessToken, body: { title: "x" } });
    expect(wrongKind.status).toBe(404);

    const promoted = await request<{ taskId: string }>(`${legacy}/ideas/${idea.data.id}/promote`, { method: "POST", token: alice.accessToken });
    const task = await prisma.asSystem((tx) => tx.task.findUnique({ where: { id: promoted.data.taskId } }));
    expect(task?.projectId).toBe(project.data.id);

    await prisma.asSystem((tx) => tx.project.delete({ where: { id: project.data.id } }));
    const left = await prisma.asSystem((tx) => tx.capture.count({ where: { id: { in: [idea.data.id, viaNew.data.id] } } }));
    expect(left).toBe(0);
  });

  async function userIdOf(session: RegisteredSession): Promise<string> {
    const user = await prisma.asSystem((tx) => tx.user.findUniqueOrThrow({ where: { email: session.email } }));
    return user.id;
  }

  async function register(name: string): Promise<RegisteredSession> {
    const email = `${emailPrefix}-${name}@example.test`;
    const response = await request<{ accessToken: string }>("/auth/register", {
      method: "POST",
      body: { email, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    expect(workspaces.status).toBe(200);
    return { accessToken: response.data.accessToken, email, workspaceId: workspaces.data[0].id };
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

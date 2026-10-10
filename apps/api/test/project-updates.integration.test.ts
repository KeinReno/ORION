import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * UI-05 — structured project status reports. The properties that matter:
 * the author comes from the session (not the payload), a report is visible
 * to workspace members only, only its author can delete it, and a project id
 * from another workspace never resolves.
 */
describe("Project status updates (UI-05)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `project-updates-${runId}`;

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

  type UpdateDto = { id: string; health: string; summary: string; blocker: string; nextStep: string; authorId: string; mine: boolean };

  async function makeProject(ws: string, token: string, name: string): Promise<string> {
    const project = await request<{ id: string }>(`/workspaces/${ws}/projects`, { method: "POST", token, body: { name } });
    expect(project.status).toBe(201);
    return project.data.id;
  }

  it("creates a report stamped with the session user and lists it newest first", async () => {
    const alice = await register("create");
    const projectId = await makeProject(alice.workspaceId, alice.accessToken, "Проект");
    const base = `/workspaces/${alice.workspaceId}/projects/${projectId}/updates`;

    const first = await request<UpdateDto>(base, {
      method: "POST",
      token: alice.accessToken,
      // `authorId` in the payload must be ignored: there is no such input field.
      body: { health: "on_track", summary: "Всё идёт", authorId: "someone-else" }
    });
    expect(first.status).toBe(201);
    expect(first.data.authorId).toBe(alice.user.id);
    expect(first.data.mine).toBe(true);
    expect(first.data.blocker).toBe("");

    const second = await request<UpdateDto>(base, {
      method: "POST",
      token: alice.accessToken,
      body: { health: "delayed", summary: "Сдвиг", blocker: "Ждём поставку", nextStep: "Позвонить поставщику" }
    });
    expect(second.status).toBe(201);

    const list = await request<UpdateDto[]>(base, { method: "GET", token: alice.accessToken });
    expect(list.data.map((u) => u.id)).toEqual([second.data.id, first.data.id]);
    expect(list.data[0]).toMatchObject({ health: "delayed", blocker: "Ждём поставку", nextStep: "Позвонить поставщику" });
  });

  it("rejects an unknown health value and an empty summary", async () => {
    const alice = await register("invalid");
    const projectId = await makeProject(alice.workspaceId, alice.accessToken, "Проект");
    const base = `/workspaces/${alice.workspaceId}/projects/${projectId}/updates`;
    expect((await request(base, { method: "POST", token: alice.accessToken, body: { health: "great", summary: "x" } })).status).toBe(400);
    expect((await request(base, { method: "POST", token: alice.accessToken, body: { health: "at_risk", summary: "   " } })).status).toBe(400);
  });

  it("only the author may delete; a non-member sees nothing and a foreign project id is a 404", async () => {
    const alice = await register("owner");
    const bob = await register("outsider");
    const projectId = await makeProject(alice.workspaceId, alice.accessToken, "Проект");
    const base = `/workspaces/${alice.workspaceId}/projects/${projectId}/updates`;
    const created = await request<UpdateDto>(base, { method: "POST", token: alice.accessToken, body: { health: "at_risk", summary: "Риск" } });

    // Bob is not a member of Alice's workspace: membership check, not a silent empty list.
    expect((await request(base, { method: "GET", token: bob.accessToken })).status).toBe(403);
    expect((await request(`${base}/${created.data.id}`, { method: "DELETE", token: bob.accessToken })).status).toBe(403);

    // Alice's project id used under Bob's own workspace must not resolve.
    const crossBase = `/workspaces/${bob.workspaceId}/projects/${projectId}/updates`;
    expect((await request(crossBase, { method: "GET", token: bob.accessToken })).status).toBe(404);

    // A second member who is not the author cannot delete it either.
    await prisma.asSystem(async (tx) => {
      await tx.workspaceMember.create({ data: { workspaceId: alice.workspaceId, userId: bob.user.id, role: "member" } });
    });
    expect((await request(`${base}/${created.data.id}`, { method: "DELETE", token: bob.accessToken })).status).toBe(404);
    const stillThere = await request<UpdateDto[]>(base, { method: "GET", token: bob.accessToken });
    expect(stillThere.data).toHaveLength(1);
    expect(stillThere.data[0].mine).toBe(false);

    expect((await request(`${base}/${created.data.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
    expect((await request<UpdateDto[]>(base, { method: "GET", token: alice.accessToken })).data).toEqual([]);
  });

  it("a risky report notifies the other members (not the author); a routine one notifies nobody", async () => {
    const alice = await register("notify-author");
    const bob = await register("notify-member");
    await prisma.asSystem(async (tx) => {
      await tx.workspaceMember.create({ data: { workspaceId: alice.workspaceId, userId: bob.user.id, role: "member" } });
    });
    const projectId = await makeProject(alice.workspaceId, alice.accessToken, "Сайт");
    const base = `/workspaces/${alice.workspaceId}/projects/${projectId}/updates`;
    type Item = { kind: string; title: string; entityType: string | null; entityId: string | null };
    const inbox = async (token: string): Promise<Item[]> =>
      (await request<Item[]>(`/workspaces/${alice.workspaceId}/notifications`, { method: "GET", token })).data.filter((n) => n.kind === "project_update");

    expect((await request(base, { method: "POST", token: alice.accessToken, body: { health: "on_track", summary: "Всё по плану" } })).status).toBe(201);
    expect(await inbox(bob.accessToken)).toHaveLength(0);

    expect((await request(base, { method: "POST", token: alice.accessToken, body: { health: "delayed", summary: "Сдвигаем релиз" } })).status).toBe(201);
    const forBob = await inbox(bob.accessToken);
    expect(forBob).toHaveLength(1);
    expect(forBob[0]).toMatchObject({ entityType: "project", entityId: projectId });
    expect(forBob[0].title).toContain("Сайт");
    // Your own report never notifies you.
    expect(await inbox(alice.accessToken)).toHaveLength(0);
  });

  it("the project itself carries the newest reported health, and null when nobody reported", async () => {
    const alice = await register("health");
    const projectId = await makeProject(alice.workspaceId, alice.accessToken, "Проект");
    const base = `/workspaces/${alice.workspaceId}/projects`;
    type ProjectDto = { id: string; reportedHealth: string | null; reportedAt: string | null };

    const before = await request<ProjectDto[]>(base, { method: "GET", token: alice.accessToken });
    expect(before.data.find((p) => p.id === projectId)).toMatchObject({ reportedHealth: null, reportedAt: null });

    await request(`${base}/${projectId}/updates`, { method: "POST", token: alice.accessToken, body: { health: "on_track", summary: "Старт" } });
    const newest = await request<UpdateDto>(`${base}/${projectId}/updates`, { method: "POST", token: alice.accessToken, body: { health: "at_risk", summary: "Риск по срокам" } });

    const list = await request<ProjectDto[]>(base, { method: "GET", token: alice.accessToken });
    expect(list.data.find((p) => p.id === projectId)?.reportedHealth).toBe("at_risk");
    const detail = await request<ProjectDto>(`${base}/${projectId}`, { method: "GET", token: alice.accessToken });
    expect(detail.data.reportedHealth).toBe("at_risk");

    // Deleting the newest report falls back to the previous one.
    await request(`${base}/${projectId}/updates/${newest.data.id}`, { method: "DELETE", token: alice.accessToken });
    const after = await request<ProjectDto>(`${base}/${projectId}`, { method: "GET", token: alice.accessToken });
    expect(after.data.reportedHealth).toBe("on_track");
  });
});

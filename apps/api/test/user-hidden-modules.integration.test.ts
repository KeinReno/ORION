import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * A user hides a module from their OWN sidebar. It is a per-user view
 * preference: it must persist, must not leak to another user, and must not
 * change the workspace's real module switch (which also gates the API).
 */
describe("Personal hidden modules", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `hidden-modules-${runId}`;

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

  it("defaults to nothing hidden and persists a personal list", async () => {
    const alice = await register("persist");
    const fresh = await request<{ hiddenModules: string[] }>("/settings/preferences", { method: "GET", token: alice.accessToken });
    expect(fresh.status).toBe(200);
    expect(fresh.data.hiddenModules).toEqual([]);

    const saved = await request<{ hiddenModules: string[] }>("/settings/preferences", {
      method: "PATCH",
      token: alice.accessToken,
      body: { hiddenModules: ["time", "habits"] }
    });
    expect(saved.status).toBe(200);
    expect(saved.data.hiddenModules).toEqual(["time", "habits"]);

    const again = await request<{ hiddenModules: string[] }>("/settings/preferences", { method: "GET", token: alice.accessToken });
    expect(again.data.hiddenModules).toEqual(["time", "habits"]);
  });

  it("is personal: another user and the workspace's own module switch are untouched", async () => {
    const alice = await register("personal-a");
    const bob = await register("personal-b");
    await request("/settings/preferences", { method: "PATCH", token: alice.accessToken, body: { hiddenModules: ["tasks"] } });

    const bobPrefs = await request<{ hiddenModules: string[] }>("/settings/preferences", { method: "GET", token: bob.accessToken });
    expect(bobPrefs.data.hiddenModules).toEqual([]);

    // Still enabled for the workspace: the personal list never reaches `disabledModules`.
    const workspaces = await request<Array<{ id: string; disabledModules: string[] }>>("/workspaces/me", { method: "GET", token: alice.accessToken });
    expect(workspaces.data.find((w) => w.id === alice.workspaceId)?.disabledModules).not.toContain("tasks");
  });

  it("rejects an oversized list", async () => {
    const alice = await register("toomany");
    const response = await request("/settings/preferences", {
      method: "PATCH",
      token: alice.accessToken,
      body: { hiddenModules: Array.from({ length: 41 }, (_, i) => `m${i}`) }
    });
    expect(response.status).toBe(400);
  });

  it("keeps personal sidebar folders per user and validates them", async () => {
    const alice = await register("folders-a");
    const bob = await register("folders-b");
    const folders = [
      { id: "f1", name: "Работа", collapsed: false, items: ["tasks", "calendar"] },
      { id: "f2", name: "Дом", collapsed: true, items: [] }
    ];
    const saved = await request<{ sidebarFolders: typeof folders }>("/settings/preferences", {
      method: "PATCH",
      token: alice.accessToken,
      body: { sidebarFolders: folders }
    });
    expect(saved.status).toBe(200);
    expect(saved.data.sidebarFolders).toEqual(folders);

    const again = await request<{ sidebarFolders: typeof folders }>("/settings/preferences", { method: "GET", token: alice.accessToken });
    expect(again.data.sidebarFolders).toEqual(folders);

    // Personal: another user starts with none, and a fresh account has an empty list.
    const other = await request<{ sidebarFolders: unknown[] }>("/settings/preferences", { method: "GET", token: bob.accessToken });
    expect(other.data.sidebarFolders).toEqual([]);

    // An empty name, too many folders and an oversized item list are all rejected.
    const patch = (value: unknown) => request("/settings/preferences", { method: "PATCH", token: alice.accessToken, body: { sidebarFolders: value } });
    expect((await patch([{ id: "x", name: "", collapsed: false, items: [] }])).status).toBe(400);
    expect((await patch(Array.from({ length: 13 }, (_, i) => ({ id: `f${i}`, name: "n", collapsed: false, items: [] })))).status).toBe(400);
    expect((await patch([{ id: "x", name: "n", collapsed: false, items: Array.from({ length: 61 }, (_, i) => `p${i}`) }])).status).toBe(400);
  });

  it("the extracted built-in plugin is ON for an existing-style workspace and can be switched off and back", async () => {
    const alice = await register("plugin-toggle");
    type State = { id: string; enabled: boolean; defaultEnabled: boolean; extendsModuleId: string };
    const base = `/workspaces/${alice.workspaceId}/plugins`;

    const initial = await request<State[]>(base, { method: "GET", token: alice.accessToken });
    const insights = initial.data.find((p) => p.id === "habits-insights");
    // Default-full parity: a workspace that never touched plugins keeps what it had before the extraction.
    expect(insights).toMatchObject({ enabled: true, defaultEnabled: true, extendsModuleId: "habits" });
    // The pre-existing optional plugin did not change its default.
    expect(initial.data.find((p) => p.id === "team")?.enabled).toBe(false);

    const off = await request<State[]>(`${base}/habits-insights`, { method: "PATCH", token: alice.accessToken, body: { enabled: false } });
    expect(off.status).toBe(200);
    expect(off.data.find((p) => p.id === "habits-insights")?.enabled).toBe(false);

    const back = await request<State[]>(`${base}/habits-insights`, { method: "PATCH", token: alice.accessToken, body: { enabled: true } });
    expect(back.data.find((p) => p.id === "habits-insights")?.enabled).toBe(true);

    const unknown = await request(`${base}/no-such-plugin`, { method: "PATCH", token: alice.accessToken, body: { enabled: true } });
    expect(unknown.status).toBe(404);
  });
});

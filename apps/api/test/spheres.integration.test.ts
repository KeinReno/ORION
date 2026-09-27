import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface RegisteredSession {
  accessToken: string;
  user: { id: string };
  email: string;
  workspaceId: string;
}

/**
 * U05 (24-CONNECTED-CORE-BACKLOG.md) — "Личные сферы, presets, переключатель
 * и избранное". Done-criteria, verified against real RLS (not a unit mock):
 *  (a) the SAME shared workspace can sit in different spheres for two
 *      different members at once, with different names/order — a sphere is
 *      per-user metadata, not a property of the workspace
 *      (23-UNIVERSAL-CONNECTED-CORE.md, "Иерархия и владение");
 *  (b) losing membership drops a workspace out of the ex-member's spheres/
 *      favorites (lazily filtered on every read, per SettingsService);
 *  (c) moving a workspace between spheres is pure UI metadata — it changes
 *      neither the caller's access nor the workspace's data (a note stays
 *      visible/unchanged, and the assignment call itself enforces membership
 *      by rejecting a foreign workspace with 403/404).
 */
describe("Personal workspace spheres (U05)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `u05-${runId}`;

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
      // See CLAUDE.md "Чистка после интеграционного теста обязана удалять и
      // пространство, не только пользователя" — WorkspaceMember cascades from
      // User, but the workspace itself (and everything in it) does not.
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

  it("lets two members of the SAME workspace keep independently named/ordered spheres", async () => {
    const alice = await register("alice-shared");
    const bob = await register("bob-shared");

    // Bob invites Alice into his workspace — now both are members of the same one.
    const shared = bob.workspaceId;
    const invite = await request<{ acceptUrl: string }>(`/workspaces/${shared}/invites`, {
      method: "POST",
      token: bob.accessToken,
      body: { email: alice.email }
    });
    expect(invite.status).toBe(201);
    const token = new URL(invite.data.acceptUrl).searchParams.get("token") as string;
    const accept = await request(`/invites/${token}/accept`, { method: "POST", token: alice.accessToken });
    expect(accept.status).toBe(201);

    // Alice files the shared workspace under her own "Работа" sphere...
    const aliceSphere = await request<{ spheres: Array<{ id: string; name: string }> }>("/settings/organization/spheres", {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Работа" }
    });
    expect(aliceSphere.status).toBe(201);
    const aliceSphereId = aliceSphere.data.spheres.find((s) => s.name === "Работа")!.id;
    const aliceAssign = await request("/settings/organization/workspace-sphere", {
      method: "PUT",
      token: alice.accessToken,
      body: { workspaceId: shared, sphereId: aliceSphereId }
    });
    expect(aliceAssign.status).toBe(200);

    // ...while Bob files it under his own "Дом", first in his own order.
    const bobSphere = await request<{ spheres: Array<{ id: string; name: string }> }>("/settings/organization/spheres", {
      method: "POST",
      token: bob.accessToken,
      body: { name: "Дом" }
    });
    expect(bobSphere.status).toBe(201);
    const bobSphereId = bobSphere.data.spheres.find((s) => s.name === "Дом")!.id;
    const bobAssign = await request("/settings/organization/workspace-sphere", {
      method: "PUT",
      token: bob.accessToken,
      body: { workspaceId: shared, sphereId: bobSphereId }
    });
    expect(bobAssign.status).toBe(200);

    const aliceOrg = await request<{ spheres: Array<{ id: string; name: string; workspaceIds: string[] }> }>(
      "/settings/organization",
      { method: "GET", token: alice.accessToken }
    );
    const bobOrg = await request<{ spheres: Array<{ id: string; name: string; workspaceIds: string[] }> }>(
      "/settings/organization",
      { method: "GET", token: bob.accessToken }
    );

    const aliceView = aliceOrg.data.spheres.find((s) => s.workspaceIds.includes(shared));
    const bobView = bobOrg.data.spheres.find((s) => s.workspaceIds.includes(shared));
    expect(aliceView?.name).toBe("Работа");
    expect(bobView?.name).toBe("Дом");
    // Neither user's sphere assignment leaked into the other's list.
    expect(bobOrg.data.spheres.some((s) => s.name === "Работа")).toBe(false);
    expect(aliceOrg.data.spheres.some((s) => s.name === "Дом")).toBe(false);
  });

  it("drops a workspace from the sphere/favorites of a user who is no longer a member", async () => {
    const owner = await register("owner-revoke");
    const guest = await register("guest-revoke");

    const shared = owner.workspaceId;
    const invite = await request<{ acceptUrl: string }>(`/workspaces/${shared}/invites`, {
      method: "POST",
      token: owner.accessToken,
      body: { email: guest.email }
    });
    const token = new URL(invite.data.acceptUrl).searchParams.get("token") as string;
    await request(`/invites/${token}/accept`, { method: "POST", token: guest.accessToken });

    const sphere = await request<{ spheres: Array<{ id: string; name: string }> }>("/settings/organization/spheres", {
      method: "POST",
      token: guest.accessToken,
      body: { name: "Гостевое" }
    });
    const sphereId = sphere.data.spheres[0].id;
    await request("/settings/organization/workspace-sphere", {
      method: "PUT",
      token: guest.accessToken,
      body: { workspaceId: shared, sphereId }
    });
    await request(`/settings/organization/favorites/${shared}`, {
      method: "PUT",
      token: guest.accessToken,
      body: { favorite: true }
    });

    const before = await request<{
      spheres: Array<{ id: string; workspaceIds: string[] }>;
      favoriteWorkspaceIds: string[];
    }>("/settings/organization", { method: "GET", token: guest.accessToken });
    expect(before.data.spheres.find((s) => s.id === sphereId)?.workspaceIds).toContain(shared);
    expect(before.data.favoriteWorkspaceIds).toContain(shared);

    // Find guest's membership row and remove it directly (equivalent to the
    // owner removing them via WorkspaceMembersController) — the point is the
    // *read side* of spheres/favorites, not the removal endpoint itself.
    const guestMembership = await prisma.asSystem((tx) =>
      tx.workspaceMember.findFirstOrThrow({ where: { workspaceId: shared, userId: guest.user.id } })
    );
    await prisma.asSystem((tx) => tx.workspaceMember.delete({ where: { id: guestMembership.id } }));

    const after = await request<{
      spheres: Array<{ id: string; workspaceIds: string[] }>;
      favoriteWorkspaceIds: string[];
    }>("/settings/organization", { method: "GET", token: guest.accessToken });
    expect(after.data.spheres.find((s) => s.id === sphereId)?.workspaceIds).not.toContain(shared);
    expect(after.data.favoriteWorkspaceIds).not.toContain(shared);
    // The sphere itself (now empty) survives — only membership in it drops,
    // not the personal grouping the user set up.
    expect(after.data.spheres.some((s) => s.id === sphereId)).toBe(true);
  });

  it("moving a workspace between spheres changes only personal metadata, never access or data", async () => {
    const alice = await register("alice-move");

    const note = await request<{ id: string; title: string }>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Не трогать", body: "содержимое" }
    });
    expect(note.status).toBe(201);

    const home = await request<{ spheres: Array<{ id: string; name: string }> }>("/settings/organization/spheres", {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Дом" }
    });
    const homeId = home.data.spheres[0].id;
    const work = await request<{ spheres: Array<{ id: string; name: string }> }>("/settings/organization/spheres", {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Работа" }
    });
    const workId = work.data.spheres.find((s) => s.name === "Работа")!.id;

    await request("/settings/organization/workspace-sphere", {
      method: "PUT",
      token: alice.accessToken,
      body: { workspaceId: alice.workspaceId, sphereId: homeId }
    });
    // Move it to the other sphere — the server must drop it from "Дом" itself
    // (no client-side orchestration of the previous sphere required).
    const moved = await request<{ spheres: Array<{ id: string; name: string; workspaceIds: string[] }> }>(
      "/settings/organization/workspace-sphere",
      { method: "PUT", token: alice.accessToken, body: { workspaceId: alice.workspaceId, sphereId: workId } }
    );
    expect(moved.status).toBe(200);
    const homeAfter = moved.data.spheres.find((s) => s.id === homeId)!;
    const workAfter = moved.data.spheres.find((s) => s.id === workId)!;
    expect(homeAfter.workspaceIds).not.toContain(alice.workspaceId);
    expect(workAfter.workspaceIds).toContain(alice.workspaceId);

    // Data and access are untouched by the move: the note is still there.
    const notesAfter = await request<Array<{ id: string; title: string }>>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(notesAfter.data.some((n) => n.id === note.data.id && n.title === "Не трогать")).toBe(true);

    // A sphere-only workspace_id that the caller has no membership in is
    // rejected outright — spheres cannot be used to probe/reach foreign
    // workspaces.
    const stranger = await register("stranger-move");
    const foreign = await request("/settings/organization/workspace-sphere", {
      method: "PUT",
      token: alice.accessToken,
      body: { workspaceId: stranger.workspaceId, sphereId: workId }
    });
    expect(foreign.status).toBe(403);
  });

  it("an account with no spheres at all still reads a valid (empty) organization", async () => {
    const solo = await register("solo-no-spheres");
    const org = await request<{ spheres: unknown[]; favoriteWorkspaceIds: unknown[] }>("/settings/organization", {
      method: "GET",
      token: solo.accessToken
    });
    expect(org.status).toBe(200);
    expect(org.data.spheres).toEqual([]);
    expect(org.data.favoriteWorkspaceIds).toEqual([]);
  });

  async function register(name: string): Promise<RegisteredSession> {
    const email = `${emailPrefix}-${name}@example.test`;
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);

    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", {
      method: "GET",
      token: response.data.accessToken
    });
    expect(workspaces.status).toBe(200);
    return { ...response.data, email, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(
    path: string,
    options: { method: string; token?: string; body?: unknown }
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }
});

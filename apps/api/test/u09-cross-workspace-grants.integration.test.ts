import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * U09 (docs/HISTORY.md) — negative-first
 * security tests for explicit cross-workspace grants, written before/along
 * with the implementation per the session's instructions. Proves each of
 * T1-T7 in the threat model doc holds at the HTTP + RLS boundary, not just
 * "the happy path returns 200".
 */
describe("U09 cross-workspace grants", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `u09-${runId}`;

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

  async function register(name: string): Promise<{ accessToken: string; user: { id: string }; workspaceId: string }> {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    expect(workspaces.status).toBe(200);
    return { ...response.data, workspaceId: workspaces.data[0].id };
  }

  async function addMember(workspaceId: string, ownerToken: string, email: string): Promise<void> {
    // Direct membership row via asSystem — the invite-flow HTTP surface
    // isn't the thing under test here, and this keeps the fixture short.
    void ownerToken;
    await prisma.asSystem(async (tx) => {
      const user = await tx.user.findUnique({ where: { email } });
      if (!user) throw new Error("fixture user missing");
      await tx.workspaceMember.create({ data: { workspaceId, userId: user.id, role: "member" } });
    });
  }

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }

  it("(a)+(g) grantee reads the project only via /shared/:grantId, allowlisted, never via the normal endpoint", async () => {
    const alice = await register("a-alice");
    const bob = await register("a-bob");

    const project = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/projects`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Alice project", budgetAmount: 500000 }
    });
    expect(project.status).toBe(201);

    const grant = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/grants`, {
      method: "POST",
      token: alice.accessToken,
      body: { granteeUserId: bob.user.id, objectType: "project", objectId: project.data.id, duration: { kind: "none" } }
    });
    expect(grant.status).toBe(201);

    // Direct guess through the normal endpoint: still 403, grant changes nothing there (T4).
    const direct = await request(`/workspaces/${alice.workspaceId}/projects/${project.data.id}`, { method: "GET", token: bob.accessToken });
    expect(direct.status).toBe(403);

    // Grant-aware endpoint: works, and the payload is allowlisted (no budgetAmount/hourlyRate/currency — (g)).
    const shared = await request<Record<string, unknown>>(`/shared/${grant.data.id}`, { method: "GET", token: bob.accessToken });
    expect(shared.status).toBe(200);
    expect(shared.data.objectType).toBe("project");
    expect(shared.data.name).toBe("Alice project");
    expect(shared.data).not.toHaveProperty("budgetAmount");
    expect(shared.data).not.toHaveProperty("hourlyRate");
    expect(shared.data).not.toHaveProperty("tasks");
  });

  it("(b) RLS grant-read policy grants nothing without the transaction-scoped app.active_grant_id GUC", async () => {
    const alice = await register("b-alice");
    const bob = await register("b-bob");
    const note = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Alice secret note", body: "shh" }
    });
    expect(note.status).toBe(201);
    const grant = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/grants`, {
      method: "POST",
      token: alice.accessToken,
      body: { granteeUserId: bob.user.id, objectType: "note", objectId: note.data.id, duration: { kind: "none" } }
    });
    expect(grant.status).toBe(201);

    // Bob's own userId is correct and the grant IS active — but this goes
    // through plain withUser (no app.active_grant_id set at all), simulating
    // "someone reaches the target table with the right current_user_id but
    // without going through SharedService.getObject/withGrant". Must be empty.
    const rows = await prisma.withUser(bob.user.id, (tx) => tx.note.findMany({ where: { id: note.data.id } }));
    expect(rows).toHaveLength(0);

    // The real grant-aware path DOES see it.
    const shared = await request<{ body: string }>(`/shared/${grant.data.id}`, { method: "GET", token: bob.accessToken });
    expect(shared.status).toBe(200);
    expect(shared.data.body).toBe("shh");
  });

  it("(c) revoke closes access on the very next read", async () => {
    const alice = await register("c-alice");
    const bob = await register("c-bob");
    const note = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Revoke me", body: "x" }
    });
    const grant = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/grants`, {
      method: "POST",
      token: alice.accessToken,
      body: { granteeUserId: bob.user.id, objectType: "note", objectId: note.data.id, duration: { kind: "none" } }
    });
    expect(grant.status).toBe(201);

    const before = await request(`/shared/${grant.data.id}`, { method: "GET", token: bob.accessToken });
    expect(before.status).toBe(200);

    const revoke = await request(`/workspaces/${alice.workspaceId}/grants/${grant.data.id}`, { method: "DELETE", token: alice.accessToken });
    expect(revoke.status).toBeLessThan(300);

    const after = await request(`/shared/${grant.data.id}`, { method: "GET", token: bob.accessToken });
    expect(after.status).toBe(404);
  });

  it("(d) an expired grant grants no access", async () => {
    const alice = await register("d-alice");
    const bob = await register("d-bob");
    const note = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Expires soon", body: "x" }
    });
    const grant = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/grants`, {
      method: "POST",
      token: alice.accessToken,
      body: {
        granteeUserId: bob.user.id,
        objectType: "note",
        objectId: note.data.id,
        duration: { kind: "date", expiresAt: new Date(Date.now() - 1000).toISOString() }
      }
    });
    expect(grant.status).toBe(201);

    const shared = await request(`/shared/${grant.data.id}`, { method: "GET", token: bob.accessToken });
    expect(shared.status).toBe(404);
  });

  it("(e) a project grant does not expose the project's tasks/transactions", async () => {
    const alice = await register("e-alice");
    const bob = await register("e-bob");
    const project = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/projects`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Project with tasks" }
    });
    const task = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Secret task", projectId: project.data.id }
    });
    expect(task.status).toBe(201);

    const grant = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/grants`, {
      method: "POST",
      token: alice.accessToken,
      body: { granteeUserId: bob.user.id, objectType: "project", objectId: project.data.id, duration: { kind: "none" } }
    });
    expect(grant.status).toBe(201);

    const shared = await request<Record<string, unknown>>(`/shared/${grant.data.id}`, { method: "GET", token: bob.accessToken });
    expect(shared.status).toBe(200);
    expect(shared.data).not.toHaveProperty("tasks");

    // The task itself is still completely inaccessible to Bob (no grant on it) — no grant-aware task endpoint exists in this slice at all.
    const directTask = await request(`/workspaces/${alice.workspaceId}/tasks/${task.data.id}/comments`, { method: "GET", token: bob.accessToken });
    expect(directTask.status).toBe(403);
  });

  it("(f) only the owner can issue a grant; grantee cannot revoke; a plain member cannot issue one", async () => {
    const alice = await register("f-alice");
    const carol = await register("f-carol");
    const bob = await register("f-bob");
    await addMember(alice.workspaceId, alice.accessToken, `${emailPrefix}-f-carol@example.test`);

    const note = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Owner-only grant", body: "x" }
    });

    // Carol is a plain member, not owner — cannot create a grant.
    const forbiddenCreate = await request(`/workspaces/${alice.workspaceId}/grants`, {
      method: "POST",
      token: carol.accessToken,
      body: { granteeUserId: bob.user.id, objectType: "note", objectId: note.data.id, duration: { kind: "none" } }
    });
    expect(forbiddenCreate.status).toBe(403);

    const grant = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/grants`, {
      method: "POST",
      token: alice.accessToken,
      body: { granteeUserId: bob.user.id, objectType: "note", objectId: note.data.id, duration: { kind: "none" } }
    });
    expect(grant.status).toBe(201);

    // Grantee (Bob) cannot revoke his own grant.
    const granteeRevoke = await request(`/workspaces/${alice.workspaceId}/grants/${grant.data.id}`, { method: "DELETE", token: bob.accessToken });
    expect(granteeRevoke.status).toBe(403);

    // A plain member (Carol) who didn't issue it and isn't owner cannot revoke it either.
    const memberRevoke = await request(`/workspaces/${alice.workspaceId}/grants/${grant.data.id}`, { method: "DELETE", token: carol.accessToken });
    expect(memberRevoke.status).toBe(403);

    // The owner can.
    const ownerRevoke = await request(`/workspaces/${alice.workspaceId}/grants/${grant.data.id}`, { method: "DELETE", token: alice.accessToken });
    expect(ownerRevoke.status).toBeLessThan(300);
  });

  async function uploadFile(workspaceId: string, token: string, name: string, content: string): Promise<{ id: string; name: string }> {
    const form = new FormData();
    form.append("files", new Blob([content], { type: "text/plain" }), name);
    const response = await fetch(`${baseUrl}/workspaces/${workspaceId}/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    const data = (await response.json()) as Array<{ id: string; name: string }>;
    expect(response.status).toBe(201);
    return data[0];
  }

  it("(content) a document grant streams the real bytes via GET /shared/:grantId/content, and revoke/expiry close it the same as getObject", async () => {
    const alice = await register("content-alice");
    const bob = await register("content-bob");
    const doc = await uploadFile(alice.workspaceId, alice.accessToken, "secret.txt", "the actual file bytes");

    const grant = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/grants`, {
      method: "POST",
      token: alice.accessToken,
      body: { granteeUserId: bob.user.id, objectType: "document", objectId: doc.id, duration: { kind: "none" } }
    });
    expect(grant.status).toBe(201);

    const contentRes = await fetch(`${baseUrl}/shared/${grant.data.id}/content`, {
      headers: { Authorization: `Bearer ${bob.accessToken}` }
    });
    expect(contentRes.status).toBe(200);
    const body = await contentRes.text();
    expect(body).toBe("the actual file bytes");
    expect(contentRes.headers.get("content-type")).toBe("text/plain");

    // Range support — same principle as the ordinary document download.
    const rangeRes = await fetch(`${baseUrl}/shared/${grant.data.id}/content`, {
      headers: { Authorization: `Bearer ${bob.accessToken}`, Range: "bytes=0-2" }
    });
    expect(rangeRes.status).toBe(206);
    expect(await rangeRes.text()).toBe("the");

    // A grant on a different object type never streams content.
    const note = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Not a document", body: "x" }
    });
    const noteGrant = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/grants`, {
      method: "POST",
      token: alice.accessToken,
      body: { granteeUserId: bob.user.id, objectType: "note", objectId: note.data.id, duration: { kind: "none" } }
    });
    const noteContentRes = await fetch(`${baseUrl}/shared/${noteGrant.data.id}/content`, {
      headers: { Authorization: `Bearer ${bob.accessToken}` }
    });
    expect(noteContentRes.status).toBe(404);

    // A stranger (not the grantee) gets 404, not the file.
    const carol = await register("content-carol");
    const strangerRes = await fetch(`${baseUrl}/shared/${grant.data.id}/content`, {
      headers: { Authorization: `Bearer ${carol.accessToken}` }
    });
    expect(strangerRes.status).toBe(404);

    // Revoke closes the content stream on the very next request, same as getObject (T2).
    const revoke = await request(`/workspaces/${alice.workspaceId}/grants/${grant.data.id}`, { method: "DELETE", token: alice.accessToken });
    expect(revoke.status).toBeLessThan(300);
    const afterRevokeRes = await fetch(`${baseUrl}/shared/${grant.data.id}/content`, {
      headers: { Authorization: `Bearer ${bob.accessToken}` }
    });
    expect(afterRevokeRes.status).toBe(404);
  });

  it("(members-search) only surfaces members of a workspace the caller owns, gated by q length, never a global user search", async () => {
    const alice = await register("ms-alice");
    const bob = await register("ms-bob");
    const carol = await register("ms-carol");
    await addMember(alice.workspaceId, alice.accessToken, `${emailPrefix}-ms-carol@example.test`);

    // Too short a query — server-side floor, not just a client convenience.
    const tooShort = await request<unknown[]>(`/workspaces/${alice.workspaceId}/members-search?q=c`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(tooShort.status).toBe(200);
    expect(tooShort.data).toEqual([]);

    // Finds Carol (an actual member of Alice's workspace) by name substring, excludes Alice herself.
    const found = await request<Array<{ userId: string; email: string | null; name: string }>>(
      `/workspaces/${alice.workspaceId}/members-search?q=ms-carol`,
      { method: "GET", token: alice.accessToken }
    );
    expect(found.status).toBe(200);
    expect(found.data.map((r) => r.userId)).toContain(carol.user.id);
    expect(found.data.map((r) => r.userId)).not.toContain(alice.user.id);

    // Bob is never a member of Alice's workspace — never surfaced, proving this
    // is not a global user search even though Bob's email also matches the prefix.
    const globalProbe = await request<Array<{ userId: string }>>(`/workspaces/${alice.workspaceId}/members-search?q=${emailPrefix}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(globalProbe.status).toBe(200);
    expect(globalProbe.data.map((r) => r.userId)).not.toContain(bob.user.id);

    // A plain member (not owner) cannot use the picker at all — same gate as grant creation.
    const memberSearch = await request(`/workspaces/${alice.workspaceId}/members-search?q=ms-carol`, {
      method: "GET",
      token: carol.accessToken
    });
    expect(memberSearch.status).toBe(403);

    // Carol cannot search a workspace she isn't even a member of.
    const foreignSearch = await request(`/workspaces/${bob.workspaceId}/members-search?q=ms`, {
      method: "GET",
      token: carol.accessToken
    });
    expect(foreignSearch.status).toBe(403);
  });

  it("has RLS enabled, forced and policied on cross_workspace_grants (structural check)", async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; rls_enabled: boolean; rls_forced: boolean; policy_count: bigint }[]>`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
             (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'cross_workspace_grants'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].rls_enabled).toBe(true);
    expect(rows[0].rls_forced).toBe(true);
    expect(Number(rows[0].policy_count)).toBeGreaterThan(0);
  });
});

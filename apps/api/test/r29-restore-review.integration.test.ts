import { SnapshotService } from "../src/sync/snapshot.service";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
 
/**
 * U09 (docs/SONNET_IMPLEMENTATION/27-U09-THREAT-MODEL.md) — negative-first
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


  async function fixture(label: string, member = false) {
    const owner = await register(`${label}-owner`);
    const guest = await register(`${label}-guest`);
    if (member) await addMember(owner.workspaceId, owner.accessToken, `${emailPrefix}-${label}-guest@example.test`);
    const note = await request<{ id: string }>(`/workspaces/${owner.workspaceId}/notes`, { method: "POST", token: owner.accessToken, body: {title: "Shared note", body: "secret"} });
    expect(note.status).toBe(201);
    const grant = await request<{id:string}>(`/workspaces/${owner.workspaceId}/grants`, {method:"POST", token:owner.accessToken, body:{granteeUserId:guest.user.id,objectType:"note",objectId:note.data.id,duration:{kind:"none"}}});
    expect(grant.status).toBe(201);
    return {owner,guest,note,grant};
  }

  it("R29 restoring a snapshot must not reactivate a revoked grant", async () => {
    const {owner,guest,grant}=await fixture("restore");
    const snapshots=app.get(SnapshotService);
    const snapshot=await prisma.withUser(owner.user.id, tx=> snapshots.serialize(tx,owner.workspaceId));
    const revoked=await request(`/workspaces/${owner.workspaceId}/grants/${grant.data.id}`,{method:"DELETE",token:owner.accessToken});
    expect(revoked.status).toBeLessThan(300);
    expect((await request(`/shared/${grant.data.id}`,{method:"GET",token:guest.accessToken})).status).toBe(404);
    await prisma.withUser(owner.user.id,tx=>snapshots.apply(tx,snapshot));
    expect((await request(`/shared/${grant.data.id}`,{method:"GET",token:guest.accessToken})).status).toBe(404);
  });

  // --- R29-02 acceptance addendum (29-REVIEW-GRANTS.md: "restore снимка без
  // grant-таблицы, отсутствие shared-объектов в backup получателя") --------

  it("R29-02 addendum: apply() tolerates a snapshot missing the crossWorkspaceGrants key entirely, without reactivating anything", async () => {
    const { owner, guest, grant } = await fixture("no-grant-table");
    const snapshots = app.get(SnapshotService);
    const snapshot = await prisma.withUser(owner.user.id, (tx) => snapshots.serialize(tx, owner.workspaceId));
    // Simulate an even-older/corrupted snapshot payload that (still claims
    // version 2 but) never populated this table's key at all — apply()'s
    // `snapshot.tables[m.key] ?? []` fallback must handle this, and the
    // absence of the key must not somehow leave the current active grant
    // reachable. Deleting the key entirely is a stricter version of "the
    // table has no rows" (`snapshot.tables.crossWorkspaceGrants = []`).
    const mutated = { ...snapshot, tables: { ...snapshot.tables } };
    delete (mutated.tables as Record<string, unknown>).crossWorkspaceGrants;
    await expect(prisma.withUser(owner.user.id, (tx) => snapshots.apply(tx, mutated))).resolves.not.toThrow();
    const res = await request(`/shared/${grant.data.id}`, { method: "GET", token: guest.accessToken });
    expect(res.status).toBe(404);
  });

  it("R29-02 addendum: a grantee's own workspace backup never contains the owner's grant or the shared object", async () => {
    const { guest, note } = await fixture("no-leak-into-grantee-backup");
    const snapshots = app.get(SnapshotService);
    const guestSnapshot = await prisma.withUser(guest.user.id, (tx) => snapshots.serialize(tx, guest.workspaceId));
    // The grant row belongs to owner.workspaceId, and the shared note lives
    // in owner's workspace too — neither should ever surface in a snapshot
    // scoped to a completely different workspace, even though guest is the
    // grantee.
    expect(guestSnapshot.tables.crossWorkspaceGrants).toEqual([]);
    const noteIds = (guestSnapshot.tables.notes as Array<{ id: string }>).map((n) => n.id);
    expect(noteIds).not.toContain(note.data.id);
  });
});

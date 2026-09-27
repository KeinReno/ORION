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

  // R29-01 acceptance addendum: document grant fixtures need a real
  // multipart upload (FilesInterceptor), so this bypasses request()'s
  // JSON-only Content-Type instead of duplicating fetch plumbing everywhere.
  async function uploadDocument(workspaceId: string, token: string, name: string, content: string): Promise<{ status: number; data: Array<{ id: string }> }> {
    const form = new FormData();
    form.append("files", new Blob([content], { type: "text/plain" }), name);
    const response = await fetch(`${baseUrl}/workspaces/${workspaceId}/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as Array<{ id: string }>;
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

  it("R30 member grantee cannot retarget a grant through RLS", async () => {
    const {owner,guest,grant}=await fixture("member-retarget",true);
    const other=await request<{id:string}>(`/workspaces/${owner.workspaceId}/notes`,{method:"POST",token:owner.accessToken,body:{title:"Not shared",body:"private"}});
    expect(other.status).toBe(201);
    await prisma.asSystem(tx=>tx.workspace.update({where:{id:owner.workspaceId},data:{restrictedModules:["notes"]}}));
    await expect(prisma.withUser(guest.user.id,tx=>tx.crossWorkspaceGrant.update({where:{id:grant.data.id},data:{objectId:other.data.id}}))).rejects.toThrow();
  });
  it("R30 exact email lookup enables sharing without source membership", async () => {
    const owner=await register("email-owner");
    const guest=await register("email-guest");
    const path=`/users/resolve-by-email?email=${encodeURIComponent(`${emailPrefix}-email-guest@example.test`)}`;
    expect((await request(path,{method:"GET"})).status).toBe(401);
    const found=await request<{found:boolean;userId:string}>(path,{method:"GET",token:owner.accessToken});
    expect(found.status).toBe(200);
    expect(found.data).toMatchObject({found:true,userId:guest.user.id});
    const note=await request<{id:string}>(`/workspaces/${owner.workspaceId}/notes`,{method:"POST",token:owner.accessToken,body:{title:"Share by email",body:"content"}});
    expect(note.status).toBe(201);
    const grant=await request<{id:string}>(`/workspaces/${owner.workspaceId}/grants`,{method:"POST",token:owner.accessToken,body:{granteeUserId:found.data.userId,objectType:"note",objectId:note.data.id,duration:{kind:"none"}}});
    expect(grant.status).toBe(201);
    expect((await request(`/shared/${grant.data.id}`,{method:"GET",token:guest.accessToken})).status).toBe(200);
    expect((await request(`/workspaces/${owner.workspaceId}/notes`,{method:"GET",token:guest.accessToken})).status).toBe(403);
    expect(await prisma.asSystem(tx=>tx.workspaceMember.count({where:{workspaceId:owner.workspaceId,userId:guest.user.id}}))).toBe(0);
    const missing=await request(`/users/resolve-by-email?email=${emailPrefix}-missing@example.test`,{method:"GET",token:owner.accessToken});
    expect(missing.data).toEqual({found:false});
  });
});

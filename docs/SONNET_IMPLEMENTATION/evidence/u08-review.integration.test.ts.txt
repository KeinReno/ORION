import { RemindersService } from "../src/search/reminders.service";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface RegisteredSession {
  accessToken: string;
  user: { id: string };
  workspaceId: string;
}

/**
 * U08 "Личный межпространственный обзор" (24-CONNECTED-CORE-BACKLOG.md).
 * Proves the actual done-criterion, not just a mock: a user who is a member
 * of two real workspaces, each with its own RLS-checked task assigned to
 * them, gets both back from `GET /me/overview` with the correct
 * workspaceId/workspaceName on each row — and a user with no membership in
 * either workspace, or with a task in the *other* workspace not assigned to
 * them, sees none of it. `pnpm test:integration` only, against real
 * Postgres/RLS — a unit mock of `PrismaService.withUser` would not have
 * caught a missing per-workspace RLS context.
 */
describe("GET /me/overview — U08 cross-workspace aggregation", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `overview-${runId}`;

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
      // Same two-step cleanup as api-rls.integration.test.ts: deleting the
      // user only removes the WorkspaceMember row (cascade), the workspace
      // and everything in it survives unless deleted explicitly too.
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true } });
        if (users.length === 0) return;
        const userIds = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({
          where: { userId: { in: userIds } },
          select: { workspaceId: true }
        });
        const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
  });

  async function fixture(name: string) {
    const owner = await register(name + "-owner");
    const member = await register(name + "-member");
    const rows = await prisma.asSystem(async tx => {
      const membership = await tx.workspaceMember.create({data:{workspaceId:owner.workspaceId,userId:member.user.id,role:"member"}});
      await tx.workspace.update({where:{id:owner.workspaceId},data:{disabledModules:[],restrictedModules:[]}});
      const task = await tx.task.create({data:{workspaceId:owner.workspaceId,title:"SECRET TASK",assigneeId:membership.id}});
      const account = await tx.account.create({data:{workspaceId:owner.workspaceId,name:"SECRET ACCOUNT",startingBalance:123456}});
      const note = await tx.note.create({data:{workspaceId:owner.workspaceId,title:"SECRET NOTE",body:"",tags:[]}});
      return {task,account,note};
    });
    return {owner,member,...rows};
  }
  it("REVIEW restricted modules must not leak through overview", async () => {
    const f = await fixture("overview-restricted");
    await prisma.asSystem(tx => tx.workspace.update({where:{id:f.owner.workspaceId},data:{restrictedModules:["tasks","finance"]}}));
    const response = await request<{tasks:{id:string}[];accounts:{id:string}[]}>("/me/overview",{method:"GET",token:f.member.accessToken});
    expect(response.status).toBe(200);
    expect({task:response.data.tasks.some(x=>x.id===f.task.id),account:response.data.accounts.some(x=>x.id===f.account.id)}).toEqual({task:false,account:false});
  });
  it("REVIEW reminder list must hide target title after restriction", async () => {
    const f = await fixture("reminder-restricted");
    const service = app.get(RemindersService);
    await service.create(f.member.user.id,f.owner.workspaceId,{entityType:"note",entityId:f.note.id,scheduledAt:new Date(Date.now()+3600000).toISOString(),timezone:"UTC"});
    await prisma.asSystem(tx=>tx.workspace.update({where:{id:f.owner.workspaceId},data:{restrictedModules:["notes"]}}));
    const rows = await service.list(f.member.user.id,f.owner.workspaceId);
    expect(rows.some(x=>x.entityTitle==="SECRET NOTE")).toBe(false);
  });
  it("REVIEW revoked module access must prevent unlink", async () => {
    const f = await fixture("unlink-restricted");
    const link = await request<{id:string}>(`/workspaces/${f.owner.workspaceId}/links`,{method:"POST",token:f.member.accessToken,body:{sourceType:"task",sourceId:f.task.id,targetType:"note",targetId:f.note.id,kind:"related_to"}});
    expect(link.status).toBe(201);
    await prisma.asSystem(tx=>tx.workspace.update({where:{id:f.owner.workspaceId},data:{restrictedModules:["tasks","notes"]}}));
    const result = await request(`/workspaces/${f.owner.workspaceId}/links/${link.data.id}`,{method:"DELETE",token:f.member.accessToken});
    expect([403,404]).toContain(result.status);
  });
  async function register(name: string): Promise<RegisteredSession> {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", {
      method: "GET",
      token: response.data.accessToken
    });
    expect(workspaces.status).toBe(200);
    expect(workspaces.data).toHaveLength(1);
    return { ...response.data, workspaceId: workspaces.data[0].id };
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


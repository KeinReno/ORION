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

  it("aggregates tasks assigned to the caller from every workspace they're a member of, without leaking others'", async () => {
    const alice = await register("alice");
    const bob = await register("bob");

    // Give alice a second workspace ("Работа" alongside her original one).
    const second = await request<{ id: string }>("/workspaces", {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Работа" }
    });
    expect(second.status).toBe(201);
    const workB = second.data.id;

    // Enable the "Команда" plugin in both workspaces (DB-direct — this test
    // is about overview aggregation, not the plugin-toggle endpoint) so
    // task.assigneeId can be set at all (TasksService.assertAssigneeWriteTx).
    await prisma.asSystem((tx) =>
      tx.workspace.updateMany({
        where: { id: { in: [alice.workspaceId, workB] } },
        data: { pluginOverrides: ["team"] }
      })
    );

    const aliceMemberA = await prisma.asSystem((tx) =>
      tx.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: alice.workspaceId, userId: alice.user.id } }
      })
    );
    const aliceMemberB = await prisma.asSystem((tx) =>
      tx.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: workB, userId: alice.user.id } }
      })
    );

    // Task assigned to alice in workspace A.
    const taskA = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Задача в пространстве А", description: "", priority: "normal", assigneeId: aliceMemberA.id }
    });
    expect(taskA.status).toBe(201);

    // Task assigned to alice in workspace B.
    const taskB = await request<{ id: string }>(`/workspaces/${workB}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Задача в пространстве Б", description: "", priority: "normal", assigneeId: aliceMemberB.id }
    });
    expect(taskB.status).toBe(201);

    // Unassigned task in workspace A — must NOT show up in alice's overview.
    const unassigned = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Ничья задача", description: "", priority: "normal" }
    });
    expect(unassigned.status).toBe(201);

    // Bob's own private workspace, with a task assigned to himself.
    const bobMember = await prisma.asSystem((tx) =>
      tx.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: bob.workspaceId, userId: bob.user.id } }
      })
    );
    await prisma.asSystem((tx) =>
      tx.workspace.update({ where: { id: bob.workspaceId }, data: { pluginOverrides: ["team"] } })
    );
    const bobTask = await request<{ id: string }>(`/workspaces/${bob.workspaceId}/tasks`, {
      method: "POST",
      token: bob.accessToken,
      body: { title: "Задача Боба", description: "", priority: "normal", assigneeId: bobMember.id }
    });
    expect(bobTask.status).toBe(201);

    // --- alice's overview: both her tasks, tagged with the right workspace, nothing else ---
    const aliceOverview = await request<{
      workspaces: Array<{ id: string; name: string }>;
      tasks: Array<{ id: string; workspaceId: string; workspaceName: string; title: string }>;
    }>("/me/overview", { method: "GET", token: alice.accessToken });
    expect(aliceOverview.status).toBe(200);

    const aliceTaskIds = aliceOverview.data.tasks.map((t) => t.id);
    expect(aliceTaskIds).toContain(taskA.data.id);
    expect(aliceTaskIds).toContain(taskB.data.id);
    expect(aliceTaskIds).not.toContain(unassigned.data.id);
    expect(aliceTaskIds).not.toContain(bobTask.data.id);

    const fromA = aliceOverview.data.tasks.find((t) => t.id === taskA.data.id);
    const fromB = aliceOverview.data.tasks.find((t) => t.id === taskB.data.id);
    expect(fromA?.workspaceId).toBe(alice.workspaceId);
    expect(fromB?.workspaceId).toBe(workB);
    expect(fromB?.workspaceName).toBe("Работа");

    const overviewWorkspaceIds = aliceOverview.data.workspaces.map((w) => w.id);
    expect(overviewWorkspaceIds).toContain(alice.workspaceId);
    expect(overviewWorkspaceIds).toContain(workB);

    // --- bob's overview: only his own task, never alice's or the workspaces he isn't a member of ---
    const bobOverview = await request<{ tasks: Array<{ id: string }> }>("/me/overview", {
      method: "GET",
      token: bob.accessToken
    });
    expect(bobOverview.status).toBe(200);
    const bobTaskIds = bobOverview.data.tasks.map((t) => t.id);
    expect(bobTaskIds).toEqual([bobTask.data.id]);
  });

  it("rejects an unauthenticated request", async () => {
    const response = await request("/me/overview", { method: "GET" });
    expect(response.status).toBe(401);
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

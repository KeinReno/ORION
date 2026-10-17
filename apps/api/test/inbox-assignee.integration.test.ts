import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Live U01 pass (Playwright, 2026-09-27): in a team workspace the Tasks
 * panel opens on «Только мои» (assignedToMe=true), but a task created by
 * triaging one's own inbox had no assignee — it vanished for the person who
 * had just created it. The triaging member is now the default assignee;
 * a personal (no team plugin) workspace keeps tasks unassigned.
 */
interface RegisteredSession {
  accessToken: string;
  user: { id: string };
  workspaceId: string;
}

describe("inbox → task assignee in a team workspace", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `inbox-assign-${runId}`;

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
        const users = await tx.user.findMany({
          where: { email: { startsWith: emailPrefix } },
          select: { id: true }
        });
        if (users.length === 0) return;
        const userIds = users.map((user) => user.id);
        const memberships = await tx.workspaceMember.findMany({
          where: { userId: { in: userIds } },
          select: { workspaceId: true }
        });
        const workspaceIds = [...new Set(memberships.map((membership) => membership.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
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

  async function processToTask(s: RegisteredSession): Promise<{ id: string; assigneeId: string | null }> {
    const item = await request<{ id: string }>(`/workspaces/${s.workspaceId}/inbox`, {
      method: "POST",
      token: s.accessToken,
      body: { title: "Купить плёнку" }
    });
    expect(item.status, JSON.stringify(item.data)).toBe(201);
    const processed = await request<{ targetId: string }>(`/workspaces/${s.workspaceId}/inbox/${item.data.id}/process`, {
      method: "POST",
      token: s.accessToken,
      body: { kind: "task" }
    });
    expect([200, 201]).toContain(processed.status);
    const tasks = await request<Array<{ id: string; assigneeId: string | null }>>(`/workspaces/${s.workspaceId}/tasks`, {
      method: "GET",
      token: s.accessToken
    });
    const task = tasks.data.find((t) => t.id === processed.data.targetId);
    expect(task).toBeDefined();
    return task as { id: string; assigneeId: string | null };
  }

  it("assigns the triaging member and shows the task under assignedToMe", async () => {
    const s = await register("team");
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: s.workspaceId }, data: { pluginOverrides: ["team"] } }));
    const task = await processToTask(s);
    const me = await prisma.asSystem((tx) =>
      tx.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: s.workspaceId, userId: s.user.id } } })
    );
    expect(task.assigneeId).toBe(me.id);
    const mine = await request<Array<{ id: string }>>(`/workspaces/${s.workspaceId}/tasks?assignedToMe=true`, {
      method: "GET",
      token: s.accessToken
    });
    expect(mine.data.map((t) => t.id)).toContain(task.id);
  });

  it("leaves the task unassigned without the team plugin", async () => {
    const s = await register("solo");
    const task = await processToTask(s);
    expect(task.assigneeId).toBeNull();
  });
});

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SchedulerRegistry } from "@nestjs/schedule";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { BackgroundJobSupervisor } from "../src/common/background-job-supervisor";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface Session {
  accessToken: string;
  userId: string;
  workspaceId: string;
}

/** Foundation Core (task 01.3): a disabled module pauses its background tick; enabling resumes it. */
describe("Background job lifecycle gate", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let supervisor: BackgroundJobSupervisor;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `jobs-${runId}@example.test`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    // The gate is driven explicitly; let no wall-clock cron interfere.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
    supervisor = app.get(BackgroundJobSupervisor);
  }, 120000);

  afterAll(async () => {
    if (prisma) {
      await prisma.asSystem(async (tx) => {
        const user = await tx.user.findFirst({ where: { email } });
        if (!user) return;
        const memberships = await tx.workspaceMember.findMany({ where: { userId: user.id }, select: { workspaceId: true } });
        const workspaceIds = memberships.map((row) => row.workspaceId);
        await tx.user.deleteMany({ where: { id: user.id } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      });
    }
    await app?.close();
  });

  it("skips a workspace tick while tasks is off and runs it again after enabling", async () => {
    const session = await register();
    const ticks: string[] = [];
    const tick = async () => { ticks.push("tick"); };

    expect(await supervisor.isEnabledForWorkspace("tasks", session.workspaceId)).toBe(true);
    expect(await supervisor.runWorkspaceJob("tasks", "due-tasks", session.workspaceId, tick)).toBe(true);
    expect(ticks).toHaveLength(1);

    expect((await request(`/workspaces/${session.workspaceId}/modules/tasks`, {
      method: "PATCH", token: session.accessToken, body: { enabled: false, confirm: true }
    })).status).toBe(200);
    expect(await supervisor.isEnabledForWorkspace("tasks", session.workspaceId)).toBe(false);
    expect(await supervisor.runWorkspaceJob("tasks", "due-tasks", session.workspaceId, tick)).toBe(false);
    expect(ticks).toHaveLength(1);

    const registry = await request<{ definitions: Array<{ componentId: string; jobName: string }>; states: Array<{ componentId: string; jobName: string; paused?: number }> }>(
      "/system/jobs/registry", { method: "GET", token: session.accessToken }
    );
    expect(registry.status).toBe(200);
    expect(registry.data.definitions).toContainEqual(expect.objectContaining({ componentId: "tasks", jobName: "due-tasks" }));
    expect(registry.data.states.find((row) => row.componentId === "tasks" && row.jobName === "due-tasks")?.paused).toBeGreaterThanOrEqual(1);

    expect((await request(`/workspaces/${session.workspaceId}/modules/tasks`, {
      method: "PATCH", token: session.accessToken, body: { enabled: true }
    })).status).toBe(200);
    expect(await supervisor.runWorkspaceJob("tasks", "due-tasks", session.workspaceId, tick)).toBe(true);
    expect(ticks).toHaveLength(2);
  }, 60000);

  async function register(): Promise<Session> {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST", body: { email, password: "integration-password-123", name: "Jobs" }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    expect(workspaces.status).toBe(200);
    return { accessToken: response.data.accessToken, userId: response.data.user.id, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }
});

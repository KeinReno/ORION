import { Module, type INestApplication, type ModuleMetadata } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SchedulerRegistry } from "@nestjs/schedule";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { TaskClosureRegistry } from "../src/tasks/public/task-closure-registry";
import { TimeModule } from "../src/time/time.module";
import { TimeTaskClosureBridge } from "../src/time/time-task-closure.service";

const imports = Reflect.getMetadata("imports", AppModule) as NonNullable<ModuleMetadata["imports"]>;
class WithoutTimeApp {}
Module({ imports: imports.filter((entry) => entry !== TimeModule) })(WithoutTimeApp);

interface Session { accessToken: string; workspaceId: string; }
interface TaskRow { id: string; revision: number; status: string; }

describe("Tasks / Time synchronous bridge (ADR-0027)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const prefix = `task-time-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  async function start(module: typeof AppModule): Promise<INestApplication> {
    const instance = await NestFactory.create(module, { logger: false });
    configureApp(instance);
    await instance.listen(0, "127.0.0.1");
    for (const job of instance.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    return instance;
  }
  const urlOf = (instance: INestApplication) => `http://127.0.0.1:${(instance.getHttpServer().address() as { port: number }).port}`;

  beforeAll(async () => {
    app = await start(AppModule);
    baseUrl = urlOf(app);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    try {
      if (prisma) await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
        const ids = users.map((user) => user.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: ids } }, select: { workspaceId: true } });
        const workspaceIds = [...new Set(memberships.map((member) => member.workspaceId))];
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        await tx.user.deleteMany({ where: { id: { in: ids } } });
        expect(await tx.workspace.count({ where: { id: { in: workspaceIds } } })).toBe(0);
      });
    } finally { await app?.close(); }
  });

  it.each(["done", "canceled"])("%s stops the timer before the HTTP response, without touching another workspace", async (status) => {
    const own = await fixture(`close-${status}`);
    const foreign = await fixture(`foreign-${status}`);
    const forbidden = await request(`/workspaces/${own.session.workspaceId}/tasks/${own.task.id}`, "PATCH", foreign.session, { status });
    expect([403, 404]).toContain(forbidden.status);
    expect((await timer(own.timerId)).endedAt).toBeNull();
    expect((await patch(own, { status })).status).toBe(200);
    expect((await timer(own.timerId)).endedAt).not.toBeNull();
    expect((await request(`/workspaces/${own.session.workspaceId}/time/running`, "GET", own.session)).data).toBeNull();
    expect((await timer(foreign.timerId)).endedAt).toBeNull();
  });

  it("keeps the safe end time and never rewrites a previously stopped entry", async () => {
    const own = await fixture("safe-end");
    const future = new Date(Date.now() + 60_000);
    await prisma.asSystem((tx) => tx.timeEntry.update({ where: { id: own.timerId }, data: { startedAt: future } }));
    expect((await patch(own, { status: "done" })).status).toBe(200);
    const endedAt = (await timer(own.timerId)).endedAt!;
    expect(endedAt.getTime()).toBe(future.getTime() + 1000);
    expect((await patch(own, { status: "todo" })).status).toBe(200);
    expect((await patch(own, { status: "canceled" })).status).toBe(200);
    expect((await timer(own.timerId)).endedAt).toEqual(endedAt);
  });

  it("keeps persisted timer data when Time is disabled and allows Tasks to close", async () => {
    const own = await fixture("time-off");
    // The normal UI refuses disabling Time with a running timer. Also cover a
    // persisted off-state restored from an older snapshot/configuration.
    expect((await request(`/workspaces/${own.session.workspaceId}/modules/time`, "PATCH", own.session, { enabled: false })).status).toBe(409);
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: own.session.workspaceId }, data: { disabledModules: { push: "time" } } }));
    const before = await timer(own.timerId);
    expect((await patch(own, { status: "done" })).status).toBe(200);
    expect(await timer(own.timerId)).toEqual(before);
    expect((await request(`/workspaces/${own.session.workspaceId}/modules/time`, "PATCH", own.session, { enabled: true })).status).toBe(200);
    expect(await timer(own.timerId)).toEqual(before);
  });

  it("a stale revision does not stop the timer", async () => {
    const own = await fixture("revision");
    expect((await patch(own, { title: "Changed" })).status).toBe(200);
    expect((await patch(own, { status: "done", expectedRevision: own.task.revision })).status).toBe(409);
    expect((await timer(own.timerId)).endedAt).toBeNull();
  });

  it("a later validation error rolls task, timer, activity and outbox back together", async () => {
    const own = await fixture("validation");
    const before = await footprint(own);
    expect((await patch(own, { status: "done", dependencyIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(404);
    expect(await footprint(own)).toEqual(before);
  });

  it("failure after the Time handler rolls its already-written timer change back", async () => {
    const own = await fixture("late-handler");
    const before = await footprint(own);
    const registry = app.get(TaskClosureRegistry);
    let sawStoppedTimer = false;
    registry.register("synthetic-failure", async (tx, closure) => {
      expect(closure).toEqual({ workspaceId: own.session.workspaceId, taskId: own.task.id });
      sawStoppedTimer = (await tx.timeEntry.findUniqueOrThrow({ where: { id: own.timerId } })).endedAt !== null;
      throw new Error("Synthetic task closure failure");
    });
    try {
      expect((await patch(own, { status: "done" })).status).toBe(500);
      expect(sawStoppedTimer).toBe(true);
      expect(await footprint(own)).toEqual(before);
    } finally { registry.unregister("synthetic-failure"); }
  });

  it("Tasks works with Time physically absent from the Nest application", async () => {
    const own = await fixture("time-absent");
    const host = await start(WithoutTimeApp);
    try {
      expect(() => host.get(TimeTaskClosureBridge)).toThrow();
      const response = await request(`/workspaces/${own.session.workspaceId}/tasks/${own.task.id}`, "PATCH", own.session, { status: "done" }, urlOf(host));
      expect(response.status).toBe(200);
      expect((await timer(own.timerId)).endedAt).toBeNull();
    } finally { await host.close(); }
  });

  const timer = (id: string) => prisma.asSystem((tx) => tx.timeEntry.findUniqueOrThrow({ where: { id } }));
  const patch = (own: Awaited<ReturnType<typeof fixture>>, body: unknown) => request(`/workspaces/${own.session.workspaceId}/tasks/${own.task.id}`, "PATCH", own.session, body);
  const footprint = (own: Awaited<ReturnType<typeof fixture>>) => prisma.asSystem(async (tx) => ({
    task: await tx.task.findUniqueOrThrow({ where: { id: own.task.id } }),
    timer: await tx.timeEntry.findUniqueOrThrow({ where: { id: own.timerId } }),
    activity: await tx.taskActivity.count({ where: { taskId: own.task.id } }),
    outbox: await tx.domainEvent.count({ where: { workspaceId: own.session.workspaceId } })
  }));

  async function fixture(name: string) {
    const registered = await request<{ accessToken: string }>("/auth/register", "POST", undefined, { email: `${prefix}-${name}@example.test`, password: "integration-password-123", name });
    expect(registered.status).toBe(201);
    const session: Session = { accessToken: registered.data.accessToken, workspaceId: "" };
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", "GET", session);
    session.workspaceId = workspaces.data[0].id;
    const task = await request<TaskRow>(`/workspaces/${session.workspaceId}/tasks`, "POST", session, { title: name });
    expect(task.status).toBe(201);
    const started = await request<{ id: string }>(`/workspaces/${session.workspaceId}/time/start`, "POST", session, { taskId: task.data.id });
    expect(started.status).toBe(201);
    return { session, task: task.data, timerId: started.data.id };
  }
  async function request<T = unknown>(path: string, method: string, session?: Session, body?: unknown, origin = baseUrl): Promise<{ status: number; data: T }> {
    const response = await fetch(`${origin}${path}`, { method, headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }
});

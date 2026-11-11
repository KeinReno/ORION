import { Module, type INestApplication, type ModuleMetadata } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SchedulerRegistry } from "@nestjs/schedule";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { TasksService } from "../src/tasks/tasks.service";
import { ProjectsService } from "../src/projects/projects.service";
import { TaskIntegrationReader } from "../src/tasks/public/task-integration-reader";
import { ProjectReferences } from "../src/projects/public/project-references";

const hostModules = new Set(["ScheduleModule", "PrismaModule", "BackgroundJobsModule", "ProjectAggregateModule",
  "AuthModule", "WorkspacesModule", "ModulesModule", "PluginsModule", "StorageModule", "TimeModule", "EventsModule", "DomainEventsModule"]);
const appImports = Reflect.getMetadata("imports", AppModule) as NonNullable<ModuleMetadata["imports"]>;
class IntegrationHost {}
Module({ imports: appImports.filter(entry => {
  const candidate = typeof entry === "function" ? entry : "module" in entry ? entry.module : undefined;
  return candidate && hostModules.has(candidate.name);
}) })(IntegrationHost);

type Session = { accessToken: string; user: { id: string }; workspaceId: string };
type Linked = { id: string; projectId: string | null; taskId: string | null; note: string };
const range = { startedAt: "2026-11-01T10:00:00Z", endedAt: "2026-11-01T11:00:00Z" };
const eventRange = { startAt: "2026-11-01T10:00:00Z", endAt: "2026-11-01T11:00:00Z" };

describe("Task integration projections for Time and Calendar (ADR-0030)", () => {
  let app: INestApplication, prisma: PrismaService, origin: string;
  const prefix = `time-cal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let serial = 0;
  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app); await app.listen(0, "127.0.0.1");
    origin = address(app); prisma = app.get(PrismaService);
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
  });
  afterAll(async () => {
    if (prisma) await prisma.asSystem(async tx => {
      const users = await tx.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
      const ids = users.map(user => user.id);
      const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: ids } }, select: { workspaceId: true } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      await tx.workspace.deleteMany({ where: { id: { in: memberships.map(m => m.workspaceId) } } });
    });
    await app?.close();
  });
  async function request<T = Linked>(session: Session | undefined, path: string, method = "GET", body?: unknown, host = origin) {
    const response = await fetch(`${host}${path}`, { method,
      headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }
  const base = (session: Session) => `/workspaces/${session.workspaceId}`;
  async function register(): Promise<Session> {
    const result = await request<Omit<Session, "workspaceId">>(undefined, "/auth/register", "POST",
      { email: `${prefix}-${++serial}@example.test`, name: "Time calendar test", password: "integration-password-123" });
    expect(result.status).toBe(201);
    const spaces = await request<Array<{ id: string }>>(result.data as Session, "/workspaces/me");
    const session = { ...result.data, workspaceId: spaces.data[0].id };
    await prisma.asSystem(tx => tx.workspace.update({ where: { id: session.workspaceId }, data: { disabledModules: [] } }));
    return session;
  }
  async function project(session: Session) {
    const result = await request(session, `${base(session)}/projects`, "POST", { name: `Project ${++serial}` });
    expect(result.status).toBe(201); return result.data.id;
  }
  async function task(session: Session, projectId: string | null = null, extra: Record<string, unknown> = {}) {
    const result = await request(session, `${base(session)}/tasks`, "POST", { title: `Task ${++serial}`, projectId, ...extra });
    expect(result.status).toBe(201); return result.data.id;
  }
  async function feed(session: Session) {
    const result = await request<{ token: string }>(session, `${base(session)}/calendar/feed`);
    expect(result.status).toBe(200); return result.data.token;
  }
  async function rawFeed(token: string, host = origin) {
    const response = await fetch(`${host}/calendar/${token}.ics`);
    return { status: response.status, body: await response.text(), type: response.headers.get("content-type") };
  }

  it("Time preserves inherited/explicit project, manual edits and null clearing", async () => {
    const alice = await register(), inherited = await project(alice), explicit = await project(alice);
    const taskId = await task(alice, inherited);
    const timer = await request(alice, `${base(alice)}/time/start`, "POST", { taskId });
    expect(timer.status).toBe(201); expect(timer.data).toMatchObject({ taskId, projectId: inherited });
    expect((await request(alice, `${base(alice)}/time/stop`, "POST", {})).status).toBe(201);
    const entry = await request(alice, `${base(alice)}/time`, "POST", { ...range, taskId, projectId: explicit, note: "original" });
    expect(entry.status).toBe(201); expect(entry.data.projectId).toBe(explicit);
    const path = `${base(alice)}/time/${entry.data.id}`;
    expect((await request(alice, path, "PATCH", { projectId: null })).data.projectId).toBe(inherited);
    const spy = vi.spyOn(app.get(TaskIntegrationReader), "referenceTx");
    const projectSpy = vi.spyOn(app.get(ProjectReferences), "existsTx");
    try {
      const cleared = await request(alice, path, "PATCH", { taskId: null, projectId: null });
      expect(cleared.status).toBe(200); expect(cleared.data).toMatchObject({ taskId: null, projectId: null, note: "original" });
      expect(spy).not.toHaveBeenCalled(); expect(projectSpy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); projectSpy.mockRestore(); }
  });

  it("Time rejects foreign/missing links without changing the old row or creating timers", async () => {
    const alice = await register(), bob = await register();
    await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: bob.workspaceId, userId: alice.user.id, role: "member" } }));
    const own = await project(alice), taskId = await task(alice, own), foreign = await project(bob), foreignTask = await task(bob, foreign);
    const entry = await request(alice, `${base(alice)}/time`, "POST", { ...range, taskId, note: "keep" });
    for (const invalid of [{ taskId: foreignTask }, { taskId: "missing" }, { projectId: foreign }, { projectId: "missing" }]) {
      expect((await request(alice, `${base(alice)}/time/${entry.data.id}`, "PATCH", { ...invalid, note: "lose" })).status).toBe(404);
      expect((await request(alice, `${base(alice)}/time/start`, "POST", invalid)).status).toBe(404);
      expect((await request(alice, `${base(alice)}/time`, "POST", { ...range, ...invalid })).status).toBe(404);
    }
    const rows = await request<{ items: Linked[] }>(alice, `${base(alice)}/time`);
    expect(rows.data.items).toEqual([expect.objectContaining({ id: entry.data.id, taskId, projectId: own, note: "keep" })]);
  });

  it("authorization precedes readers and disabled neighbors retain Time references", async () => {
    const alice = await register(), outsider = await register(), projectId = await project(alice), taskId = await task(alice, projectId);
    const taskSpy = vi.spyOn(app.get(TaskIntegrationReader), "referenceTx");
    const projectSpy = vi.spyOn(app.get(ProjectReferences), "existsTx");
    try {
      expect((await request(outsider, `${base(alice)}/time/start`, "POST", { taskId, projectId })).status).toBe(403);
      expect((await request(outsider, `${base(alice)}/events`, "POST", { ...eventRange, title: "Denied", projectId })).status).toBe(403);
      expect(taskSpy).not.toHaveBeenCalled(); expect(projectSpy).not.toHaveBeenCalled();
    } finally { taskSpy.mockRestore(); projectSpy.mockRestore(); }
    for (const module of ["tasks", "projects"]) expect((await request(alice, `${base(alice)}/modules/${module}`, "PATCH", { enabled: false, confirm: true })).status).toBe(200);
    expect((await request(alice, `${base(alice)}/tasks`)).status).toBe(409);
    const entry = await request(alice, `${base(alice)}/time`, "POST", { ...range, taskId });
    expect(entry.status).toBe(201); expect(entry.data.projectId).toBe(projectId);
  });

  it("Calendar preserves link updates, archived/disabled projects and 404 without losing data", async () => {
    const alice = await register(), bob = await register(), projectId = await project(alice), foreign = await project(bob);
    await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: bob.workspaceId, userId: alice.user.id, role: "member" } }));
    const created = await request(alice, `${base(alice)}/events`, "POST", { ...eventRange, title: "Keep event", projectId });
    expect(created.status).toBe(201);
    const path = `${base(alice)}/events/${created.data.id}`;
    for (const id of [foreign, "missing"]) expect((await request(alice, path, "PATCH", { projectId: id, title: "Lose" })).status).toBe(404);
    const current = await prisma.withUser(alice.user.id, tx => tx.event.findUniqueOrThrow({ where: { id: created.data.id } }));
    expect(current).toMatchObject({ title: "Keep event", projectId });
    expect((await request(alice, `${base(alice)}/projects/${projectId}`, "DELETE")).status).toBe(200);
    expect((await request(alice, `${base(alice)}/modules/projects`, "PATCH", { enabled: false, confirm: true })).status).toBe(200);
    expect((await request(alice, path, "PATCH", { projectId })).status).toBe(200);
    expect((await request(alice, path, "PATCH", { projectId: null })).data.projectId).toBe(null);
  });

  it("ICS preserves dated-task fields and excludes undated and foreign tasks", async () => {
    const alice = await register(), bob = await register();
    const taskId = await task(alice, null, { title: "Release, review", description: "Line one\nLine two", projectTag: "ICS scope", dueAt: "2026-11-01T10:00:00Z" });
    // Existing feed semantics include closed statuses; use the normal command to close.
    expect((await request(alice, `${base(alice)}/tasks/${taskId}`, "PATCH", { status: "done" })).status).toBe(200);
    const undated = await task(alice), foreign = await task(bob, null, { dueAt: "2026-11-01T10:00:00Z" });
    const token = await feed(alice), result = await rawFeed(token);
    expect(result.status).toBe(200); expect(result.type).toContain("text/calendar");
    expect(result.body).toContain(`UID:task-${taskId}@orion`);
    expect(result.body).toContain("DTSTART:20261101T100000Z"); expect(result.body).toContain("DTEND:20261101T101500Z");
    expect(result.body).toContain("SUMMARY:✓ [ICS scope] Release\\, review");
    expect(result.body).toContain("DESCRIPTION:Line one\\nLine two");
    expect(result.body).not.toContain(`task-${undated}`); expect(result.body).not.toContain(`task-${foreign}`);
    const spy = vi.spyOn(app.get(TaskIntegrationReader), "datedTx");
    try {
      expect((await rawFeed("not-a-valid-token")).status).toBe(404); expect(spy).not.toHaveBeenCalled();
      expect((await request(alice, `${base(alice)}/modules/tasks`, "PATCH", { enabled: false, confirm: true })).status).toBe(200);
      const withoutTasks = await rawFeed(token); expect(withoutTasks.status).toBe(200);
      expect(withoutTasks.body).not.toContain(`task-${taskId}`); expect(spy).not.toHaveBeenCalled();
      const rotated = await request<{ token: string }>(alice, `${base(alice)}/calendar/feed/rotate`, "POST");
      expect(rotated.status).toBe(201); expect((await rawFeed(token)).status).toBe(404);
      expect((await rawFeed(rotated.data.token)).status).toBe(200);
      expect((await request(alice, `${base(alice)}/plugins/calendar-external`, "PATCH", { enabled: false })).status).toBe(200);
      expect((await rawFeed(rotated.data.token)).status).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it("task projections preserve transaction visibility, exact fields, rollback and RLS", async () => {
    const alice = await register(), outsider = await register(), reader = app.get(TaskIntegrationReader);
    let id = "";
    await expect(prisma.withUser(alice.user.id, async tx => {
      const row = await tx.task.create({ data: { workspaceId: alice.workspaceId, title: "uncommitted", dueAt: new Date(range.startedAt) } });
      id = row.id;
      expect(await reader.referenceTx(tx, alice.workspaceId, id)).toEqual({ id, projectId: null, assigneeId: null });
      expect(await reader.referenceTx(tx, outsider.workspaceId, id)).toBeNull();
      const dated = await reader.datedTx(tx, alice.workspaceId);
      expect(Object.keys(dated[0]).sort()).toEqual(["description", "dueAt", "id", "projectTag", "status", "title"]);
      expect(await reader.datedTx(tx, outsider.workspaceId)).toEqual([]);
      throw new Error("task reader rollback");
    })).rejects.toThrow("task reader rollback");
    expect(await prisma.withUser(alice.user.id, tx => reader.referenceTx(tx, alice.workspaceId, id))).toBeNull();
    const committed = await task(alice, null, { dueAt: range.startedAt });
    expect(await prisma.withUser(outsider.user.id, tx => reader.referenceTx(tx, alice.workspaceId, committed))).toBeNull();
    expect(await prisma.withUser(outsider.user.id, tx => reader.datedTx(tx, alice.workspaceId))).toEqual([]);
    await prisma.asSystem(tx => tx.task.delete({ where: { id: committed } }));
    expect(await prisma.withUser(alice.user.id, tx => reader.referenceTx(tx, alice.workspaceId, committed))).toBeNull();
  });

  it("Time and Calendar run without full TasksModule or ProjectsModule", async () => {
    const alice = await register(), projectId = await project(alice), taskId = await task(alice, projectId, { dueAt: range.startedAt });
    const token = await feed(alice);
    const host = await NestFactory.create(IntegrationHost, { logger: false, abortOnError: false });
    try {
      configureApp(host); await host.listen(0, "127.0.0.1");
      for (const job of host.get(SchedulerRegistry).getCronJobs().values()) job.stop();
      expect(() => host.get(TasksService)).toThrow(); expect(() => host.get(ProjectsService)).toThrow();
      expect((await request(alice, `${base(alice)}/tasks`, "GET", undefined, address(host))).status).toBe(404);
      const entry = await request(alice, `${base(alice)}/time`, "POST", { ...range, taskId }, address(host));
      expect(entry.status).toBe(201); expect(entry.data.projectId).toBe(projectId);
      const event = await request(alice, `${base(alice)}/events`, "POST", { ...eventRange, title: "SDK host", projectId }, address(host));
      expect(event.status).toBe(201); expect(event.data.projectId).toBe(projectId);
      expect((await rawFeed(token, address(host))).body).toContain(`UID:task-${taskId}@orion`);
    } finally { await host.close(); }
  });
});
function address(app: INestApplication) { return `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`; }

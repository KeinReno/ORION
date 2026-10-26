import { Module, type INestApplication, type ModuleMetadata } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SchedulerRegistry } from "@nestjs/schedule";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { ProjectsService } from "../src/projects/projects.service";
import { ProjectReferences } from "../src/projects/public/project-references";

// Explicit composition of the five consumers and their infrastructure only.
// Other unmigrated domains still import ProjectsModule (e.g. Goals), so merely
// removing it from AppModule.imports would not prove absence of the domain.
const hostModules = new Set(["ScheduleModule", "PrismaModule", "BackgroundJobsModule", "ProjectAggregateModule",
  "AuthModule", "WorkspacesModule", "ModulesModule", "StorageModule", "NotesModule", "DocumentsModule",
  "InventoryModule", "InboxModule", "MilestonesModule"]);
const appImports = Reflect.getMetadata("imports", AppModule) as NonNullable<ModuleMetadata["imports"]>;
class ReferenceHost {}
Module({ imports: appImports.filter(entry => {
  const candidate = typeof entry === "function" ? entry : "module" in entry ? entry.module : undefined;
  return candidate && hostModules.has(candidate.name);
}) })(ReferenceHost);

type Session = { accessToken: string; user: { id: string }; workspaceId: string };
type Row = { id: string; projectId: string | null; title?: string; name?: string };
const consumers = ["notes", "documents", "inventory", "inbox", "milestones"] as const;
type Consumer = typeof consumers[number];

describe("Projects public reference contract (ADR-0029)", () => {
  let app: INestApplication, prisma: PrismaService, origin: string;
  const prefix = `project-ref-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let serial = 0;
  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    origin = address(app);
    prisma = app.get(PrismaService);
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

  async function request<T = Row>(session: Session | undefined, path: string, method = "GET", body?: unknown, host = origin) {
    const response = await fetch(`${host}${path}`, { method,
      headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }
  async function register(): Promise<Session> {
    const response = await request<Omit<Session, "workspaceId">>(undefined, "/auth/register", "POST",
      { email: `${prefix}-${++serial}@example.test`, name: "Reference test", password: "integration-password-123" });
    expect(response.status).toBe(201);
    const spaces = await request<Array<{ id: string }>>(response.data as Session, "/workspaces/me");
    const session = { ...response.data, workspaceId: spaces.data[0].id };
    await prisma.asSystem(tx => tx.workspace.update({ where: { id: session.workspaceId }, data: { disabledModules: [] } }));
    return session;
  }
  async function project(session: Session) {
    const result = await request(session, `/workspaces/${session.workspaceId}/projects`, "POST", { name: `Project ${++serial}` });
    expect(result.status).toBe(201);
    return result.data.id;
  }
  function endpoint(session: Session, consumer: Consumer) {
    return `/workspaces/${session.workspaceId}/${consumer === "inventory" ? "inventory/items" : consumer}`;
  }
  async function attempt(session: Session, consumer: Consumer, projectId: string | null, documentId?: string, host = origin) {
    const path = endpoint(session, consumer);
    if (consumer === "documents") {
      expect(documentId).toBeTruthy();
      return request(session, `${path}/${documentId}`, "PATCH", { projectId }, host);
    }
    const label = `Reference ${++serial}`;
    const body = consumer === "inventory" ? { name: label, projectId } :
      consumer === "milestones" ? { title: label, projectId, startAt: "2026-11-01T00:00:00Z", dueAt: "2026-11-02T00:00:00Z" } :
      consumer === "inbox" ? { title: label, body: "", kind: "inbox", projectId } : { title: label, body: "", tags: [], projectId };
    return request(session, path, "POST", body, host);
  }
  async function document(session: Session) {
    const result = await request(session, endpoint(session, "documents"), "POST", { name: `Folder ${++serial}`, parentId: null });
    expect(result.status).toBe(201);
    return result.data.id;
  }
  async function counts(workspaceId: string) {
    return prisma.asSystem(async tx => Promise.all([
      tx.note.count({ where: { workspaceId } }), tx.document.count({ where: { workspaceId } }),
      tx.inventoryItem.count({ where: { workspaceId } }), tx.inboxItem.count({ where: { workspaceId } }),
      tx.milestone.count({ where: { workspaceId } })]));
  }

  it.each(consumers)("%s keeps same-workspace references and rejects foreign/missing projects without partial writes", async consumer => {
    const alice = await register(), bob = await register(), outsider = await register();
    // Actor can read BOTH workspaces: explicit workspace filter, not only RLS, must reject the foreign id.
    await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: bob.workspaceId, userId: alice.user.id, role: "member" } }));
    const own = await project(alice), foreign = await project(bob);
    const doc = consumer === "documents" ? await document(alice) : undefined;
    const success = await attempt(alice, consumer, own, doc);
    expect(success.status).toBe(consumer === "documents" ? 200 : 201);
    expect(success.data.projectId).toBe(own);
    const before = await counts(alice.workspaceId);
    for (const id of [foreign, "missing-project"]) {
      const result = await attempt(alice, consumer, id, doc);
      expect(result.status).toBe(404);
      expect(result.data).toMatchObject({ message: "Проект не найден" });
      expect(await counts(alice.workspaceId)).toEqual(before);
    }
    if (doc) expect((await request<Row[]>(alice, endpoint(alice, consumer))).data.find(row => row.id === doc)?.projectId).toBe(own);
    const spy = vi.spyOn(app.get(ProjectReferences), "existsTx");
    try {
      const intruder = { ...outsider, workspaceId: alice.workspaceId };
      expect((await attempt(intruder, consumer, own, doc)).status).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it("preserves archived projects and caller-specific disabled-module policy", async () => {
    const alice = await register(), id = await project(alice), doc = await document(alice);
    expect((await request(alice, `/workspaces/${alice.workspaceId}/projects/${id}`, "DELETE")).status).toBe(200);
    for (const consumer of consumers) expect((await attempt(alice, consumer, id, doc)).status).toBe(consumer === "documents" ? 200 : 201);
    expect((await request(alice, `/workspaces/${alice.workspaceId}/modules/projects`, "PATCH", { enabled: false, confirm: true })).status).toBe(200);
    expect((await request(alice, `/workspaces/${alice.workspaceId}/projects`)).status).toBe(409);
    for (const consumer of ["notes", "documents", "inventory"] as const) {
      expect((await attempt(alice, consumer, id, doc)).status).toBe(consumer === "documents" ? 200 : 201);
    }
    // Milestones HTTP is guarded by Projects; its service policy is still only reference validity.
    expect((await attempt(alice, "milestones", id)).status).toBe(409);
    const spy = vi.spyOn(app.get(ProjectReferences), "existsTx");
    try {
      expect((await attempt(alice, "inbox", id)).status).toBe(409);
      expect(spy).not.toHaveBeenCalled();
      expect((await attempt(alice, "inbox", null)).status).toBe(201);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
    expect(await prisma.withUser(alice.user.id, tx => app.get(ProjectReferences).existsTx(tx, alice.workspaceId, id))).toBe(true);
  });

  it("validates replacement and null clearing without losing existing links", async () => {
    const alice = await register(), first = await project(alice), second = await project(alice);
    for (const consumer of ["notes", "inventory", "documents"] as const) {
      const doc = consumer === "documents" ? await document(alice) : undefined;
      const created = await attempt(alice, consumer, first, doc);
      const path = `${endpoint(alice, consumer)}/${created.data.id}`;
      expect((await request(alice, path, "PATCH", { projectId: second })).data.projectId).toBe(second);
      expect((await request(alice, path, "PATCH", { projectId: "deleted-project" })).status).toBe(404);
      // Read through the domain's normal API after rejection.
      const current = consumer === "inventory" || consumer === "documents" ?
        (await request<Row[]>(alice, endpoint(alice, consumer))).data.find(row => row.id === created.data.id)! :
        (await request(alice, path)).data;
      expect(current.projectId).toBe(second);
      const spy = vi.spyOn(app.get(ProjectReferences), "existsTx");
      try {
        expect((await request(alice, path, "PATCH", { projectId: null })).data.projectId).toBe(null);
        expect(spy).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
    }
  });

  it("uses the original transaction and RLS context, including rollback", async () => {
    const alice = await register(), outsider = await register(), reader = app.get(ProjectReferences);
    let id = "";
    await expect(prisma.withUser(alice.user.id, async tx => {
      const row = await tx.project.create({ data: { workspaceId: alice.workspaceId, name: "Uncommitted" } });
      id = row.id;
      expect(await reader.existsTx(tx, alice.workspaceId, id)).toBe(true);
      expect(await reader.existsTx(tx, outsider.workspaceId, id)).toBe(false);
      throw new Error("reference rollback");
    })).rejects.toThrow("reference rollback");
    expect(await prisma.withUser(alice.user.id, tx => reader.existsTx(tx, alice.workspaceId, id))).toBe(false);
    const committed = await project(alice);
    expect(await prisma.withUser(outsider.user.id, tx => reader.existsTx(tx, alice.workspaceId, committed))).toBe(false);
    await prisma.asSystem(tx => tx.project.delete({ where: { id: committed } }));
    expect(await prisma.withUser(alice.user.id, tx => reader.existsTx(tx, alice.workspaceId, committed))).toBe(false);
  });

  it("all five consumers run with the reference SDK and ProjectsModule physically absent", async () => {
    const alice = await register(), id = await project(alice), doc = await document(alice);
    const host = await NestFactory.create(ReferenceHost, { logger: false, abortOnError: false });
    try {
      configureApp(host);
      await host.listen(0, "127.0.0.1");
      for (const job of host.get(SchedulerRegistry).getCronJobs().values()) job.stop();
      expect(() => host.get(ProjectsService)).toThrow();
      expect((await request(alice, `/workspaces/${alice.workspaceId}/projects`, "GET", undefined, address(host))).status).toBe(404);
      for (const consumer of consumers) {
        const result = await attempt(alice, consumer, id, doc, address(host));
        expect(result.status).toBe(consumer === "documents" ? 200 : 201);
        expect(result.data.projectId).toBe(id);
      }
    } finally { await host.close(); }
  });
});
function address(app: INestApplication) {
  return `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
}

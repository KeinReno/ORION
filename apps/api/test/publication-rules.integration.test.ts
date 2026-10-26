import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SchedulerRegistry } from "@nestjs/schedule";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicationRule, PublicationRulePreview, SharedPublication } from "@orion/shared-types";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/configure-app";
import { PrismaService } from "../src/common/prisma.service";
import { PublicationRulesService } from "../src/shared/publication-rules.service";
import { PublicationRegistry } from "../src/shared/publication-registry";
import { DomainEventDispatcherService } from "../src/domain-events/domain-event-dispatcher.service";
import { TasksService } from "../src/tasks/tasks.service";
import { createTaskInputSchema } from "@orion/shared-types";
import { SnapshotService } from "../src/sync/snapshot.service";

describe("publication rules: owner consent, outbox, RLS and restore", () => {
  let app: INestApplication, prisma: PrismaService, base: string;
  type Person = { token: string; id: string; ws: string };
  let owner: Person, guest: Person, zone: string;
  async function req<T = Record<string, unknown>>(person: Person | null, path: string, method = "GET", body?: unknown) {
    const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(person ? { Authorization: `Bearer ${person.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); return { status: r.status, data: (text ? JSON.parse(text) : null) as T, text };
  }
  async function register(): Promise<Person> {
    const r = await req<{ accessToken: string; user: { id: string } }>(null, "/auth/register", "POST", { name: "Rule fixture", email: `${randomUUID()}@example.test`, password: "test-password-123" });
    expect(r.status).toBe(201);
    const person = { token: r.data.accessToken, id: r.data.user.id, ws: "" };
    person.ws = (await req<Array<{ id: string }>>(person, "/workspaces/me")).data[0]!.id;
    return person;
  }
  async function task(title = "Task", status = "todo") {
    const r = await req<{ id: string }>(owner, `/workspaces/${owner.ws}/tasks`, "POST", { title, description: "PRIVATE_TEXT [hidden](https://private.example/SECRET)", status });
    expect(r.status, r.text).toBe(201); return r.data.id;
  }
  async function rule(extra = {}) {
    const r = await req<PublicationRule>(owner, "/publication-rules", "POST", { sourceWorkspaceId: owner.ws, workspaceId: zone, name: "Explicit tasks", statuses: ["todo"], ...extra });
    expect(r.status, r.text).toBe(201); return r.data;
  }
  async function enable(row: PublicationRule) {
    const preview = await req<PublicationRulePreview>(owner, `/publication-rules/${row.id}/preview`);
    expect(preview.status, preview.text).toBe(200);
    const result = await req<PublicationRule>(owner, `/publication-rules/${row.id}/enable`, "POST", { expectedRevision: row.revision, fingerprint: preview.data.fingerprint, consentFutureRecords: true });
    expect(result.status, result.text).toBe(201); return result.data;
  }
  async function dispatchAll() {
    const backlog = await prisma.asSystem(async tx => (await tx.domainEvent.count({ where: { dispatchedAt: null } })) + (await tx.domainEventDelivery.count({ where: { status: "pending" } })));
    for (let pass = 0; pass <= Math.ceil(backlog / 100); pass++) await app.get(DomainEventDispatcherService).runOnce();
  }
  const publications = () => req<SharedPublication[]>(guest, `/publications?workspaceId=${zone}`);
  async function reconcileAll() {
    // Production deliberately bounds each pass to 20 rules. Drain a complete
    // cursor cycle so fixture assertions don't depend on other persisted rules.
    const count = await prisma.asSystem(tx => tx.publicationRule.count({ where: { enabled: true } }));
    for (let pass = 0; pass <= Math.ceil(count / 20); pass++) await app.get(PublicationRulesService).reconcile();
  }
  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false }); configureApp(app); await app.listen(0, "127.0.0.1");
    prisma = app.get(PrismaService); base = await app.getUrl();
    // This fixture advances dispatcher/reconciliation explicitly. Real clock
    // delivery is covered by the production browser scenario.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
  }, 120000);
  beforeEach(async () => {
    owner = await register(); guest = await register();
    zone = (await req<{ id: string }>(owner, "/workspaces", "POST", { name: "Shared zone" })).data.id;
    await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: zone, userId: guest.id, role: "member" } }));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (owner) await prisma.asSystem(tx => tx.publicationRule.updateMany({ where: { userId: owner.id }, data: { enabled: false } }));
  });
  afterAll(async () => { if (app) await app.close(); });

  it("requires current preview and future consent, binds fields/recipients, isolates config with FORCE RLS", async () => {
    const id = await task(); const row = await rule(); expect(row.enabled).toBe(false);
    expect((await publications()).data).toEqual([]);
    const preview = await req<PublicationRulePreview>(owner, `/publication-rules/${row.id}/preview`);
    expect(preview.data.count).toBe(1); expect(preview.data.items[0]!.content.text).toBe("");
    expect(preview.data.recipients.map(p => p.userId)).toContain(guest.id);
    expect((await req(owner, `/publication-rules/${row.id}/enable`, "POST", { expectedRevision: row.revision, fingerprint: preview.data.fingerprint })).status).toBe(400);
    await req(owner, `/workspaces/${owner.ws}/tasks/${id}`, "PATCH", { title: "Changed after preview" });
    expect((await req(owner, `/publication-rules/${row.id}/enable`, "POST", { expectedRevision: row.revision, fingerprint: preview.data.fingerprint, consentFutureRecords: true })).status).toBe(409);
    const active = await enable(row); expect(active.enabled).toBe(true);
    for (let n = 0; n < 21; n++) expect((await req(owner, `/publication-rules/${row.id}/run`, "POST", { expectedRevision: active.revision })).status).toBe(201);
    const audited = (await req<PublicationRule>(owner, `/publication-rules/${row.id}`)).data;
    expect(audited.history.length).toBeLessThanOrEqual(20);
    expect(audited.history.some(entry => entry.action === "enabled" && entry.consentFutureRecords && entry.fingerprint?.length === 64)).toBe(true);
    expect((await req(guest, `/publication-rules/${row.id}`)).status).toBe(404);
    expect((await req<PublicationRule[]>(guest, "/publication-rules")).data).toEqual([]);
    expect(await prisma.withUser(guest.id, tx => tx.publicationRule.findMany({ where: { id: row.id } }))).toEqual([]);
    await expect(prisma.withUser(guest.id, tx => tx.publicationRule.create({ data: { workspaceId: owner.ws, userId: guest.id, targetWorkspaceId: zone, config: row.config } }))).rejects.toThrow();
    const list = await publications(); expect(list.data).toHaveLength(1);
    for (const secret of [owner.ws, row.id, id, "PRIVATE_TEXT", "SECRET", "ruleId"]) expect(list.text).not.toContain(secret);
  });

  it("uses transactional outbox for future tasks, updates selected fields and safely replays", async () => {
    const active = await enable(await rule({ includeText: true }));
    const id = await task("Future");
    const dispatch = app.get(DomainEventDispatcherService);
    await dispatch.runOnce();
    const first = (await publications()).data.find(p => p.content.title === "Future")!;
    expect(first).toBeTruthy(); expect(first.content.text).toContain("PRIVATE_TEXT"); expect(first.content.text).not.toContain("SECRET");
    await req(owner, `/workspaces/${owner.ws}/tasks/${id}`, "PATCH", { title: "Automatic update", expectedRevision: 1 });
    await dispatch.runOnce();
    const changed = (await publications()).data.find(p => p.id === first.id)!;
    expect(changed.content.title).toBe("Automatic update");
    const again = await req<PublicationRule>(owner, `/publication-rules/${active.id}/run`, "POST", { expectedRevision: active.revision });
    expect(again.status, again.text).toBe(201);
    expect((await publications()).data.find(p => p.id === first.id)!.revision).toBe(changed.revision);
    const before = await prisma.withUser(owner.id, tx => tx.domainEvent.count({ where: { workspaceId: owner.ws } }));
    await expect(prisma.withUser(owner.id, async tx => {
      await app.get(TasksService).createTx(tx, owner.id, owner.ws, createTaskInputSchema.parse({ title: "Rollback sentinel" }));
      throw new Error("rollback sentinel");
    })).rejects.toThrow("rollback sentinel");
    expect(await prisma.withUser(owner.id, tx => tx.domainEvent.count({ where: { workspaceId: owner.ws } }))).toBe(before);
  });

  it("withdraws filter exits and deleted tasks, never resurrects explicitly revoked publications, preserves copies", async () => {
    const id = await task("Withdraw me"); const active = await enable(await rule());
    const first = (await publications()).data[0]!;
    const copy = await req<{ id: string }>(guest, `/publications/${first.id}/copy`, "POST", { workspaceId: guest.ws }); expect(copy.status).toBe(201);
    await req(owner, `/workspaces/${owner.ws}/tasks/${id}`, "PATCH", { status: "done" });
    await dispatchAll(); expect((await publications()).data).toEqual([]);
    await req(owner, `/workspaces/${owner.ws}/tasks/${id}`, "PATCH", { status: "todo" });
    await dispatchAll(); expect((await publications()).data).toEqual([]);
    expect((await req(guest, `/workspaces/${guest.ws}/tasks`)).text).toContain(copy.data.id);
    const future = await task("Revoke me"); await dispatchAll();
    const p = (await publications()).data[0]!; await req(owner, `/publications/${p.id}`, "DELETE");
    await req(owner, `/workspaces/${owner.ws}/tasks/${future}`, "PATCH", { title: "Do not revive" });
    await req(owner, `/publication-rules/${active.id}/run`, "POST", { expectedRevision: active.revision });
    expect((await publications()).data).toEqual([]);
    const removed = await task("Deleted original"); await dispatchAll();
    expect((await publications()).data).toHaveLength(1);
    await req(owner, `/workspaces/${owner.ws}/tasks/${removed}`, "DELETE"); await dispatchAll();
    expect((await publications()).data).toEqual([]);
  });

  it("pauses before edits and requires new confirmation to expand disclosure", async () => {
    const id = await task(); const active = await enable(await rule());
    expect((await req(owner, `/publication-rules/${active.id}`, "PATCH", { expectedRevision: active.revision, config: { ...active.config, includeText: true } })).status).toBe(409);
    const paused = await req<PublicationRule>(owner, `/publication-rules/${active.id}/pause`, "POST", { expectedRevision: active.revision }); expect(paused.status).toBe(201);
    await req(owner, `/workspaces/${owner.ws}/tasks/${id}`, "PATCH", { title: "Not yet published" }); await dispatchAll();
    expect((await publications()).data[0]!.content.title).toBe("Task");
    const edited = await req<PublicationRule>(owner, `/publication-rules/${active.id}`, "PATCH", { expectedRevision: paused.data.revision, config: { ...active.config, includeText: true } }); expect(edited.status).toBe(200);
    const reenabled = await enable(edited.data); expect((await publications()).data[0]!.content.text).toContain("PRIVATE_TEXT");
    expect((await req(owner, `/publication-rules/${active.id}`, "DELETE", { expectedRevision: reenabled.revision })).status).toBe(200);
    expect((await publications()).data).toEqual([]);
  });

  it("background rechecks membership/module authority and withdraws on loss", async () => {
    await task(); const active = await enable(await rule());
    await prisma.asSystem(tx => tx.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: zone, userId: owner.id } } }));
    await reconcileAll();
    const stored = await prisma.asSystem(tx => tx.publicationRule.findUniqueOrThrow({ where: { id: active.id } }));
    expect(stored.enabled).toBe(false); expect(stored.lastError).toBeTruthy(); expect((await publications()).data).toEqual([]);
  });

  it("does not adopt manual publications or turn their revocation into a new automatic grant", async () => {
    const id = await task("Manual origin");
    const source = { sourceWorkspaceId: owner.ws, sourceId: id, kind: "task" };
    const preview = await req<{ fingerprint: string }>(owner, "/publications/preview", "POST", source);
    const manual = await req<SharedPublication>(owner, "/publications", "POST", { ...source, workspaceId: zone, fingerprint: preview.data.fingerprint });
    expect(manual.status).toBe(201);
    const row = await rule();
    const plan = await req<PublicationRulePreview>(owner, `/publication-rules/${row.id}/preview`);
    expect(plan.data.items[0]!.action).toBe("excluded"); expect(plan.data.publishableCount).toBe(0);
    const active = await enable(row);
    expect((await publications()).data.map(p => p.id)).toEqual([manual.data.id]);
    await req(owner, `/publications/${manual.data.id}`, "DELETE");
    await req(owner, `/workspaces/${owner.ws}/tasks/${id}`, "PATCH", { title: "Still private" });
    await dispatchAll();
    await req(owner, `/publication-rules/${active.id}/run`, "POST", { expectedRevision: active.revision });
    expect((await publications()).data).toEqual([]);
  });

  it("binds confirmation to the destination membership and rejects oversized previews explicitly", async () => {
    await task(); const row = await rule();
    const preview = await req<PublicationRulePreview>(owner, `/publication-rules/${row.id}/preview`);
    const newcomer = await register();
    await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: zone, userId: newcomer.id } }));
    expect((await req(owner, `/publication-rules/${row.id}/enable`, "POST", { expectedRevision: row.revision, fingerprint: preview.data.fingerprint, consentFutureRecords: true })).status).toBe(409);
    await prisma.withUser(owner.id, tx => tx.task.createMany({ data: Array.from({ length: 101 }, (_, n) => ({ workspaceId: owner.ws, title: `Bulk ${n}` })) }));
    expect((await req(owner, `/publication-rules/${row.id}/preview`)).status).toBe(400);
    expect((await publications()).data).toEqual([]);
  });

  it("reconciliation covers writes outside TasksService and stops disabled sources without replay on re-enable", async () => {
    const active = await enable(await rule({ includeDueAt: true }));
    const direct = await prisma.withUser(owner.id, tx => tx.task.create({ data: { workspaceId: owner.ws, title: "Direct write fixture" } }));
    await reconcileAll();
    expect((await publications()).data.map(p => p.content.title)).toEqual(["Direct write fixture"]);
    // Planning cascades can change dueAt without bumping revision; reconciliation
    // must compare the permitted projection, not only the source revision.
    await prisma.withUser(owner.id, tx => tx.task.update({ where: { id: direct.id }, data: { dueAt: new Date("2030-01-01T12:00:00.000Z") } }));
    await reconcileAll();
    expect((await publications()).data[0]!.content.dueAt).toBe("2030-01-01T12:00:00.000Z");
    await prisma.asSystem(tx => tx.workspace.update({ where: { id: owner.ws }, data: { disabledModules: ["tasks"] } }));
    await reconcileAll();
    expect((await publications()).data).toEqual([]);
    await prisma.asSystem(tx => tx.workspace.update({ where: { id: owner.ws }, data: { disabledModules: [] } }));
    await reconcileAll();
    const row = await req<PublicationRule>(owner, `/publication-rules/${active.id}`);
    expect(row.data.enabled).toBe(false); expect(row.data.revision).toBeGreaterThan(active.revision);
    expect((await publications()).data).toEqual([]);
  });

  it("filters projects through the Tasks adapter and keeps overlapping rules from duplicating grants", async () => {
    const project = await req<{ id: string }>(owner, `/workspaces/${owner.ws}/projects`, "POST", { name: "Selected project" });
    expect(project.status, project.text).toBe(201);
    await task("Outside project");
    const selected = await req<{ id: string }>(owner, `/workspaces/${owner.ws}/tasks`, "POST", { title: "Inside project", projectId: project.data.id });
    expect(selected.status).toBe(201);
    await enable(await rule({ projectIds: [project.data.id] }));
    expect((await publications()).data.map(p => p.content.title)).toEqual(["Inside project"]);
    await enable(await rule({ projectIds: [project.data.id], name: "Overlapping rule" }));
    expect((await publications()).data).toHaveLength(1);
    await req(owner, `/workspaces/${owner.ws}/tasks/${selected.data.id}`, "PATCH", { projectId: null });
    await dispatchAll();
    expect((await publications()).data).toEqual([]);
  });

  it("retries transient failures through the existing outbox rather than acknowledging a failed publication", async () => {
    await enable(await rule());
    const id = await task("Retry through outbox");
    const event = await prisma.withUser(owner.id, tx => tx.domainEvent.findFirstOrThrow({ where: { workspaceId: owner.ws, type: "tasks.task.changed", payload: { path: ["id"], equals: id } } }));
    const adapter = app.get(PublicationRegistry).get("task");
    vi.spyOn(adapter, "ruleCandidates").mockRejectedValueOnce(new Error("TRANSIENT_PRIVATE_SENTINEL"));
    const dispatcher = app.get(DomainEventDispatcherService);
    await dispatcher.runOnce();
    const failed = await prisma.asSystem(tx => tx.domainEventDelivery.findFirstOrThrow({ where: { eventId: event.id, subscriberId: "tasks.publish-selected-tasks" } }));
    expect(failed.status).toBe("pending"); expect(failed.attempts).toBe(1);
    expect(failed.lastError).not.toContain("TRANSIENT_PRIVATE_SENTINEL");
    expect((await publications()).data).toEqual([]);
    await dispatcher.runOnce(new Date(Date.now() + 60000));
    expect((await publications()).data.map(p => p.content.title)).toEqual(["Retry through outbox"]);
    const delivered = await prisma.asSystem(tx => tx.domainEventDelivery.findUniqueOrThrow({ where: { id: failed.id } }));
    expect(delivered.status).toBe("done");
  });

  it("losing source ownership closes the rule even though owner RLS now hides its configuration", async () => {
    await task(); const row = await enable(await rule());
    await prisma.asSystem(tx => tx.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: owner.ws, userId: owner.id } }, data: { role: "member" } }));
    expect((await req(owner, `/publication-rules/${row.id}`)).status).toBe(404);
    await reconcileAll();
    expect((await publications()).data).toEqual([]);
    expect((await prisma.asSystem(tx => tx.publicationRule.findUniqueOrThrow({ where: { id: row.id } }))).enabled).toBe(false);
  });

  it("reconciliation advances its bounded cursor rather than starving rules after the first page", async () => {
    const ids: string[] = [];
    for (let n = 0; n < 21; n++) ids.push((await enable(await rule({ name: `Cursor rule ${n}` }))).id);
    await prisma.asSystem(tx => tx.publicationRule.updateMany({ where: { id: { in: ids } }, data: { lastRunAt: null } }));
    await app.get(PublicationRulesService).reconcile();
    const count = () => prisma.asSystem(tx => tx.publicationRule.count({ where: { id: { in: ids }, lastRunAt: { not: null } } }));
    expect(await count()).toBeLessThanOrEqual(20);
    await reconcileAll();
    expect(await count()).toBe(21);
  });

  it("restoring during a running publication cannot deadlock policy locks or reactivate its grant", async () => {
    await task(); const row = await enable(await rule());
    const snapshots = app.get(SnapshotService);
    const snapshot = await prisma.withUser(owner.id, tx => snapshots.serialize(tx, owner.ws));
    const adapter = app.get(PublicationRegistry).get("task");
    const original = adapter.ruleCandidates!.bind(adapter);
    let signalEntered!: () => void, releaseWorker!: () => void;
    const entered = new Promise<void>(resolve => { signalEntered = resolve; });
    const released = new Promise<void>(resolve => { releaseWorker = resolve; });
    vi.spyOn(adapter, "ruleCandidates").mockImplementationOnce(async (tx, config, id) => {
      signalEntered(); await released; return original(tx, config, id);
    });
    const worker = app.get(PublicationRulesService).reconcile();
    await entered;
    try {
      const restore = prisma.withUser(owner.id, tx => snapshots.apply(tx, snapshot));
      releaseWorker();
      await Promise.all([worker, restore]);
    } finally { releaseWorker(); }
    expect((await req<PublicationRule>(owner, `/publication-rules/${row.id}`)).data.enabled).toBe(false);
    expect((await publications()).data).toEqual([]);
  });

  it("restoring either endpoint pauses automation and cannot replay old grants", async () => {
    await task(); const active = await enable(await rule());
    const snapshots = app.get(SnapshotService);
    const source = await prisma.withUser(owner.id, tx => snapshots.serialize(tx, owner.ws));
    await prisma.withUser(owner.id, tx => snapshots.apply(tx, source));
    expect((await req<PublicationRule>(owner, `/publication-rules/${active.id}`)).data.enabled).toBe(false);
    await dispatchAll(); await reconcileAll();
    expect((await publications()).data).toEqual([]);
    await enable((await req<PublicationRule>(owner, `/publication-rules/${active.id}`)).data);
    const target = await prisma.withUser(owner.id, tx => snapshots.serialize(tx, zone));
    await prisma.withUser(owner.id, tx => snapshots.apply(tx, target));
    expect((await req<PublicationRule>(owner, `/publication-rules/${active.id}`)).data.enabled).toBe(false);
    await reconcileAll(); expect((await publications()).data).toEqual([]);
  });
});

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PublicationPreview, SharedPublication } from "@orion/shared-types";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/configure-app";
import { PrismaService } from "../src/common/prisma.service";
import { SnapshotService } from "../src/sync/snapshot.service";

describe("shared publications: real HTTP and FORCE RLS", () => {
  let app: INestApplication, prisma: PrismaService, base: string;
  type Person = { token: string; id: string; ws: string };
  let owner: Person, guest: Person, outsider: Person, zone: string, task: string, knowledge: string;
  async function req<T = Record<string, unknown>>(person: Person | null, path: string, method = "GET", body?: unknown) {
    const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(person ? { Authorization: `Bearer ${person.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, data: (text ? JSON.parse(text) : null) as T, text };
  }
  async function register(): Promise<Person> {
    const r = await req<{ accessToken: string; user: { id: string } }>(null, "/auth/register", "POST", { name: "Publication test", email: `${randomUUID()}@example.test`, password: "test-password-123" });
    expect(r.status).toBe(201);
    const person = { token: r.data.accessToken, id: r.data.user.id, ws: "" };
    person.ws = (await req<Array<{ id: string }>>(person, "/workspaces/me")).data[0]!.id;
    return person;
  }
  async function publish(kind: "task" | "knowledge" = "task", allowStatus = true) {
    const source = { sourceWorkspaceId: owner.ws, sourceId: kind === "task" ? task : knowledge, kind, includeText: true, includeDueAt: false };
    const preview = await req<PublicationPreview>(owner, "/publications/preview", "POST", source);
    expect(preview.status, preview.text).toBe(201);
    const r = await req<SharedPublication>(owner, "/publications", "POST", { ...source, workspaceId: zone, allowStatus: kind === "task" && allowStatus, fingerprint: preview.data.fingerprint });
    expect(r.status, r.text).toBe(201);
    return r.data;
  }
  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false }); configureApp(app); await app.listen(0, "127.0.0.1");
    base = await app.getUrl(); prisma = app.get(PrismaService);
    owner = await register(); guest = await register(); outsider = await register();
    zone = (await req<{ id: string }>(owner, "/workspaces", "POST", { name: "Publication zone" })).data.id;
    await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: zone, userId: guest.id, role: "member" } }));
    task = (await req<{ id: string }>(owner, `/workspaces/${owner.ws}/tasks`, "POST", { title: "Shared task", description: "Visible text [private source](https://private.test/DEPENDENCY_SECRET)" })).data.id;
    knowledge = (await req<{ id: string }>(owner, `/workspaces/${owner.ws}/knowledge/items`, "POST", { title: "Shared knowledge", body: "Public prose ![attachment](file:///PRIVATE_ATTACHMENT)", summary: "PRIVATE_SUMMARY", visibility: "private" })).data.id;
    expect(task).toBeTruthy(); expect(knowledge).toBeTruthy();
  }, 120000);
  beforeEach(async () => { await prisma.asSystem(tx => tx.workspace.update({ where: { id: zone }, data: { disabledModules: [] } })); await prisma.asSystem(tx => tx.sharedPublication.updateMany({ where: { publisherId: owner.id }, data: { revokedAt: new Date() } })); });
  afterAll(async () => { if (app) await app.close(); });

  it("projects only selected fields, isolates private origins and requires target membership", async () => {
    const p = await publish();
    const r = await req<SharedPublication>(guest, `/publications/${p.id}`);
    expect(r.status, r.text).toBe(200);
    for (const secret of [owner.ws, task, owner.id, "DEPENDENCY_SECRET", "private.test", "sourceRevision", "sourceId", "publisherId"]) expect(r.text).not.toContain(secret);
    expect(r.data.content.text).toContain("Visible text");
    expect(r.data.canManage).toBe(false);
    expect((await req(outsider, `/publications/${p.id}`)).status).toBe(404);
    expect((await req(guest, "/publications/preview", "POST", { sourceWorkspaceId: owner.ws, sourceId: task, kind: "task" })).status).toBe(403);
    const input = { operationId: randomUUID(), expectedRevision: p.revision, status: "in_progress" };
    const changed = await req<SharedPublication>(guest, `/publications/${p.id}/status`, "PATCH", input);
    expect(changed.status, changed.text).toBe(200);
    expect(changed.data.content.status).toBe("in_progress");
    expect((await prisma.withUser(owner.id, tx => tx.task.findUniqueOrThrow({ where: { id: task } }))).status).toBe("in_progress");
    const replay = await req<SharedPublication>(guest, `/publications/${p.id}/status`, "PATCH", input);
    expect(replay.status).toBe(200); expect(replay.data.revision).toBe(changed.data.revision);
    expect((await req(guest, `/publications/${p.id}/status`, "PATCH", { ...input, operationId: randomUUID(), status: "done" })).status).toBe(409);
    await req(owner, `/publications/${p.id}`, "DELETE");
  });

  it("supports private copies and pins without broadening authority; revocation closes reads and writes", async () => {
    const p = await publish("knowledge", false);
    expect(JSON.stringify(p)).not.toContain("PRIVATE_");
    expect((await req(guest, `/publications/${p.id}/pin`, "POST", { workspaceId: guest.ws })).status).toBe(201);
    expect((await req<SharedPublication[]>(guest, `/publications/pinned?workspaceId=${guest.ws}`)).data.map(x => x.id)).toContain(p.id);
    const copied = await req<{ id: string }>(guest, `/publications/${p.id}/copy`, "POST", { workspaceId: guest.ws });
    expect(copied.status, copied.text).toBe(201);
    expect(copied.data.id).not.toBe(knowledge);
    expect((await req(guest, `/publications/${p.id}`, "DELETE")).status).toBe(404);
    expect((await req(owner, `/publications/${p.id}`, "DELETE")).status).toBe(200);
    expect((await req(guest, `/publications/${p.id}`)).status).toBe(404);
    expect((await req<SharedPublication[]>(guest, `/publications/pinned?workspaceId=${guest.ws}`)).data).toEqual([]);
    expect((await req(guest, `/workspaces/${guest.ws}/knowledge/items/${copied.data.id}`)).status).toBe(200);
  });

  it("does not leak private conflict DTOs and rejects stale previews", async () => {
    const p = await publish();
    const original = await prisma.asSystem(tx => tx.task.findUniqueOrThrow({ where: { id: task } }));
    await req(owner, `/workspaces/${owner.ws}/tasks/${task}`, "PATCH", { expectedRevision: original.revision, description: "NEW_PRIVATE_SECRET" });
    const r = await req(guest, `/publications/${p.id}/status`, "PATCH", { operationId: randomUUID(), expectedRevision: p.revision, status: "done" });
    expect(r.status, r.text).toBe(409); expect(r.text).not.toContain("NEW_PRIVATE_SECRET"); expect(r.text).not.toContain(task);
    await req(owner, `/publications/${p.id}`, "DELETE");
    const source = { sourceWorkspaceId: owner.ws, sourceId: task, kind: "task" };
    const preview = await req<PublicationPreview>(owner, "/publications/preview", "POST", source);
    await prisma.asSystem(tx => tx.task.update({ where: { id: task }, data: { revision: { increment: 1 } } }));
    expect((await req(owner, "/publications", "POST", { ...source, workspaceId: zone, fingerprint: preview.data.fingerprint })).status).toBe(409);
  });

  it("rechecks disabled modules, read-only permission and removed membership", async () => {
    const p = await publish("task", false);
    expect((await req(guest, `/publications/${p.id}/status`, "PATCH", { operationId: randomUUID(), expectedRevision: p.revision, status: "done" })).status).toBe(403);
    await prisma.asSystem(tx => tx.workspace.update({ where: { id: zone }, data: { disabledModules: ["tasks"] } }));
    expect((await req<SharedPublication[]>(guest, `/publications?workspaceId=${zone}`)).data).toEqual([]);
    expect((await req(guest, `/publications/${p.id}`)).status).toBe(409);
    await prisma.asSystem(tx => tx.workspace.update({ where: { id: zone }, data: { disabledModules: [] } }));
    await prisma.asSystem(tx => tx.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: zone, userId: guest.id } } }));
    expect((await req(guest, `/publications/${p.id}`)).status).toBe(404);
    await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: zone, userId: guest.id } }));
    await req(owner, `/publications/${p.id}`, "DELETE");
  });

  it("restoring the source cannot resurrect delegated authority in another zone", async () => {
    const p = await publish();
    const snapshots = app.get(SnapshotService);
    await prisma.withUser(owner.id, async tx => { const snapshot = await snapshots.serialize(tx, owner.ws); await snapshots.apply(tx, snapshot); });
    expect((await req(guest, `/publications/${p.id}`)).status).toBe(404);
  });

  it("only the publisher can review and refresh the selected projection", async () => {
    const p = await publish("knowledge", false);
    await prisma.asSystem(tx => tx.knowledgeItem.update({ where: { id: knowledge }, data: { body: "Reviewed update", revision: { increment: 1 } } }));
    expect((await req(guest, `/publications/${p.id}/preview`)).status).toBe(403);
    const preview = await req<PublicationPreview>(owner, `/publications/${p.id}/preview`);
    expect(preview.status).toBe(200);
    const input = { expectedRevision: p.revision, fingerprint: preview.data.fingerprint };
    expect((await req(guest, `/publications/${p.id}`, "PATCH", input)).status).toBe(403);
    const updated = await req<SharedPublication>(owner, `/publications/${p.id}`, "PATCH", input);
    expect(updated.status, updated.text).toBe(200);
    expect(updated.data.content.text).toBe("Reviewed update");
    expect((await req(owner, `/publications/${p.id}`, "PATCH", input)).status).toBe(409);
  });

  it("serializes simultaneous status changes and denies queued writes after revocation", async () => {
    const p = await publish();
    const outcomes = await Promise.all(["done", "canceled"].map(status => req(guest, `/publications/${p.id}/status`, "PATCH", { operationId: randomUUID(), expectedRevision: p.revision, status })));
    expect(outcomes.map(r => r.status).sort()).toEqual([200, 409]);
    await req(owner, `/publications/${p.id}`, "DELETE");
    expect((await req(guest, `/publications/${p.id}/status`, "PATCH", { operationId: randomUUID(), expectedRevision: p.revision + 1, status: "todo" })).status).toBe(404);
  });

  it("source restore revokes another owner's publication in an invisible zone", async () => {
    const source = (await req<{ id: string }>(owner, "/workspaces", "POST", { name: "Shared source" })).data.id;
    const target = (await req<{ id: string }>(guest, "/workspaces", "POST", { name: "Guest zone" })).data.id;
    await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: source, userId: guest.id, role: "owner" } }));
    const item = (await req<{ id: string }>(guest, `/workspaces/${source}/tasks`, "POST", { title: "Shared-source task" })).data.id;
    const input = { sourceWorkspaceId: source, sourceId: item, kind: "task" };
    const preview = await req<PublicationPreview>(guest, "/publications/preview", "POST", input);
    const publication = await req<SharedPublication>(guest, "/publications", "POST", { ...input, workspaceId: target, fingerprint: preview.data.fingerprint, allowStatus: true });
    expect(publication.status, publication.text).toBe(201);
    const snapshots = app.get(SnapshotService);
    await prisma.withUser(owner.id, async tx => { const snapshot = await snapshots.serialize(tx, source); await snapshots.apply(tx, snapshot); });
    expect((await req(guest, `/publications/${publication.data.id}`)).status).toBe(404);
    await expect(prisma.withUser(outsider.id, tx => tx.$executeRaw`SELECT public.revoke_publications_from_source(${source})`)).rejects.toThrow();
  });
});

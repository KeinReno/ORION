import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Opportunity, OpportunityPage, OpportunityProfileDetail, HhImportRun } from "@orion/shared-types";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { SnapshotService } from "../src/sync/snapshot.service";

describe("Opportunity extensions: profiles/import isolation", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  const prefix = `opportunity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: ["error"], abortOnError: false }); configureApp(app);
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    if (prisma) await prisma.asSystem(async (tx) => {
      await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
    await app?.close();
  });
  async function request<T>(path: string, token: string, method = "GET", body?: unknown) {
    const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json() as T };
  }
  async function register(name: string) {
    const res = await request<{ accessToken: string; user: { id: string } }>("/auth/register", "", "POST", { email: `${prefix}-${name}@example.test`, password: "integration-password-123", name });
    expect(res.status).toBe(201); userIds.push(res.data.user.id);
    const workspaces = await request<{ id: string }[]>("/workspaces/me", res.data.accessToken);
    const workspaceId = workspaces.data[0].id; workspaceIds.push(workspaceId);
    return { token: res.data.accessToken, userId: res.data.user.id, workspaceId, path: `/workspaces/${workspaceId}/opportunities` };
  }

  async function enable(a: Awaited<ReturnType<typeof register>>, plugin: string) {
    expect((await request(`/workspaces/${a.workspaceId}/plugins/${plugin}`, a.token, "PATCH", { enabled: true })).status).toBe(200);
  }
  const profilePath = (ws: string) => `/workspaces/${ws}/opportunity-profiles`;
  const importPath = (ws: string) => `/workspaces/${ws}/opportunity-hh-import`;
  const vacancyFiles = (n = 1) => [{ path: "vacancies_test.json", text: JSON.stringify(Array.from({ length: n }, (_, i) => ({ title: `Synthetic ${i}`, url: `https://hh.ru/vacancy/${100000 + i}`, company: "Test", desc: "Source" }))) }];
  async function preview(a: Awaited<ReturnType<typeof register>>, files = vacancyFiles(), flags = {}) {
    const result = await request<HhImportRun>(`${importPath(a.workspaceId)}/preview`, a.token, "POST", { files, acknowledgeWorkspaceVisibility: true, ...flags });
    expect(result.status).toBe(201); return result.data;
  }
  async function apply(a: Awaited<ReturnType<typeof register>>, run: HhImportRun) {
    return request<HhImportRun>(`${importPath(a.workspaceId)}/${run.id}/apply`, a.token, "POST", { expectedRevision: run.revision, manifestHash: run.manifestHash });
  }
  it("bulk import preserves manual cards and counts repeated external IDs once while retaining distinct captures", async () => {
    const a = await register("bulk"); await enable(a, "opportunities-hh-import");
    const manual = (await request<Opportunity>(a.path, a.token, "POST", { kind: "job", title: "Manual title", sourceType: "hh", externalId: "999001" })).data;
    const files = [{ path: "vacancies_bulk.json", text: JSON.stringify(Array.from({ length: 25 }, (_, n) => ({ title: `Snapshot ${n}`, url: `https://hh.ru/vacancy/${n < 5 ? "999001" : "999002"}`, salary: { from: 100000 + n } }))) }];
    const run = await preview(a, files);
    const done = await apply(a, run);
    expect(done.status).toBe(201);
    expect(done.data.report).toMatchObject({ opportunitiesCreated: 1, opportunitiesExisting: 24, capturesCreated: 25 });
    const again = await apply(a, await preview(a, files));
    expect(again.data.report).toMatchObject({ opportunitiesCreated: 0, opportunitiesExisting: 25, capturesCreated: 0 });
    expect((await request<Opportunity>(`${a.path}/${manual.id}`, a.token)).data.title).toBe("Manual title");
    expect((await request<OpportunityPage>(a.path, a.token)).data.items).toHaveLength(2);
  });
  it("keeps plugins off by default and Base working, retains data after disable", async () => {
    const a = await register("off");
    expect((await request(profilePath(a.workspaceId), a.token)).status).toBe(409);
    expect((await request(importPath(a.workspaceId), a.token)).status).toBe(409);
    expect((await request(a.path, a.token, "POST", { kind: "job", title: "Base" })).status).toBe(201);
    await enable(a, "opportunities-profiles");
    const p = await request<OpportunityProfileDetail>(profilePath(a.workspaceId), a.token, "POST", { displayName: "Team", kind: "team", acknowledgeWorkspaceVisibility: true });
    expect(p.status).toBe(201);
    await request(`/workspaces/${a.workspaceId}/plugins/opportunities-profiles`, a.token, "PATCH", { enabled: false });
    expect((await request(`${profilePath(a.workspaceId)}/${p.data.id}`, a.token)).status).toBe(409);
    await enable(a, "opportunities-profiles");
    expect((await request<OpportunityProfileDetail>(`${profilePath(a.workspaceId)}/${p.data.id}`, a.token)).data.displayName).toBe("Team");
  });
  it("guards writes, fact confirmation CAS and foreign profile/track/material IDs", async () => {
    const a = await register("profile-owner"); const b = await register("outsider");
    await enable(a, "opportunities-profiles"); await enable(b, "opportunities-profiles");
    const p = (await request<OpportunityProfileDetail>(profilePath(a.workspaceId), a.token, "POST", { displayName: "Person", acknowledgeWorkspaceVisibility: true })).data;
    const other = (await request<OpportunityProfileDetail>(profilePath(a.workspaceId), a.token, "POST", { displayName: "Other", acknowledgeWorkspaceVisibility: true })).data;
    const fact = (await request<{id:string;state:string;revision:number}>(`${profilePath(a.workspaceId)}/${p.id}/facts`, a.token, "POST", { statement: "Test fact", source: "Test document" })).data;
    expect(fact.state).toBe("unverified");
    const changes = await Promise.all(["confirmed", "disputed"].map((state) => request(`${profilePath(a.workspaceId)}/${p.id}/facts/${fact.id}`, a.token, "PATCH", { expectedRevision: 0, state })));
    expect(changes.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await request(`${profilePath(a.workspaceId)}/${other.id}/tracks`, a.token, "POST", { name: "Invalid", factIds: [fact.id] })).status).toBe(404);
    const track = (await request<{id:string}>(`${profilePath(a.workspaceId)}/${p.id}/tracks`, a.token, "POST", { name: "Analyst", factIds: [fact.id] })).data;
    expect((await request(`${profilePath(a.workspaceId)}/${other.id}/materials`, a.token, "POST", { title: "Invalid", content: "Text", trackId: track.id })).status).toBe(404);
    const material = (await request<{id:string}>(`${profilePath(a.workspaceId)}/${p.id}/materials`, a.token, "POST", { title: "Resume", content: "Text", trackId: track.id })).data;
    expect((await request(`${profilePath(a.workspaceId)}/${other.id}/materials/${material.id}`, a.token)).status).toBe(404);
    expect((await request(`${profilePath(b.workspaceId)}/${p.id}`, b.token)).status).toBe(404);
    expect(await prisma.withUser(b.userId, (tx) => tx.opportunityProfile.findMany({ where: { id: p.id } }))).toEqual([]);
    await prisma.asSystem((tx) => tx.workspaceMember.create({ data: { workspaceId: a.workspaceId, userId: b.userId, role: "member" } }));
    expect((await request(`${profilePath(a.workspaceId)}/${p.id}`, b.token)).status).toBe(200);
    expect((await request(`${profilePath(a.workspaceId)}/${p.id}/facts`, b.token, "POST", { statement: "Denied", source: "test" })).status).toBe(403);
  });
  it("atomically checkpoints concurrent apply, deduplicates separate runs, preserves manual edits", async () => {
    const a = await register("import-concurrency"); await enable(a, "opportunities-hh-import");
    const run = await preview(a, vacancyFiles(31));
    const race = await Promise.all([apply(a, run), apply(a, run)]);
    expect(race.map((r) => r.status).sort()).toEqual([201,409]);
    const partial = race.find((r) => r.status === 201)!.data;
    expect(partial.checkpoint).toBe(25); expect(partial.status).toBe("applying"); expect(partial.report.opportunitiesCreated).toBe(25);
    const finished = await apply(a, partial); expect(finished.data.checkpoint).toBe(31); expect(finished.data.status).toBe("applied");
    expect((await apply(a, run)).data.report.opportunitiesCreated).toBe(31);
    const page = (await request<OpportunityPage>(a.path, a.token)).data;
    const card = page.items[0]; await request(`${a.path}/${card.id}`, a.token, "PATCH", { expectedRevision: 0, title: "Manual title" });
    let again = await preview(a, vacancyFiles(31)); again = (await apply(a, again)).data; again = (await apply(a, again)).data;
    expect(again.report.opportunitiesCreated).toBe(0); expect(again.report.opportunitiesExisting).toBe(31); expect(again.report.capturesCreated).toBe(0);
    expect((await request<Opportunity>(`${a.path}/${card.id}`, a.token)).data.title).toBe("Manual title");
    const salaryFiles = [{ path: "vacancies_test.json", text: JSON.stringify([{ title: "Synthetic 0", url: "https://hh.ru/vacancy/100000", company: "Test", desc: "Source", salary: { from: 150000, currency: "RUR", gross: false } }]) }];
    const salaryRun = (await apply(a, await preview(a, salaryFiles))).data;
    expect(salaryRun.report.opportunitiesCreated).toBe(0); expect(salaryRun.report.capturesCreated).toBe(1);
    const captures = await prisma.withUser(a.userId, (tx) => tx.opportunityCapture.findMany({ where: { workspaceId: a.workspaceId, sourcePath: "vacancies_test.json" } }));
    expect(captures.some((capture) => (capture.snapshot as { conditions: { amountMin: number | null } }).conditions.amountMin === 150000)).toBe(true);
  });
  it("keeps preview read-only, enforces immutable manifest/expiry and preserves committed portions on cancel", async () => {
    const a = await register("cancel"); await enable(a, "opportunities-hh-import");
    const run = await preview(a, vacancyFiles(31));
    expect(await prisma.withUser(a.userId, (tx) => tx.opportunity.count({ where: { workspaceId: a.workspaceId } }))).toBe(0);
    const path = `${importPath(a.workspaceId)}/${run.id}`;
    expect((await request(`${path}/apply`, a.token, "POST", { manifestHash: "f".repeat(64), expectedRevision: 0 })).status).toBe(409);
    const partial = (await apply(a, run)).data;
    const canceled = await request<HhImportRun>(`${path}/cancel`, a.token, "POST", { manifestHash: partial.manifestHash, expectedRevision: partial.revision });
    expect(canceled.data.status).toBe("canceled"); expect(canceled.data.checkpoint).toBe(25);
    expect((await apply(a, canceled.data)).status).toBe(409);
    expect(await prisma.withUser(a.userId, (tx) => tx.opportunity.count({ where: { workspaceId: a.workspaceId } }))).toBe(25);
    const expired = await preview(a);
    await prisma.withUser(a.userId, (tx) => tx.opportunityImport.update({ where: { id: expired.id }, data: { expiresAt: new Date(0) } }));
    expect((await apply(a, expired)).status).toBe(409);
    await request(`/workspaces/${a.workspaceId}/plugins/opportunities-hh-import`, a.token, "PATCH", { enabled: false });
    expect((await request(path, a.token)).status).toBe(409);
    await enable(a, "opportunities-hh-import");
    expect((await request<HhImportRun>(path, a.token)).data.checkpoint).toBe(25);
  });
  it("imports immutable profile versions and legacy outcomes without inventing confirmed facts", async () => {
    const a = await register("legacy"); await enable(a, "opportunities-hh-import");
    const files = [...vacancyFiles(), { path: "Person/Резюме/Analyst.md", text: "Synthetic CV" }, { path: "applications/test.json", text: JSON.stringify([{ title: "Legacy", url: "https://hh.ru/vacancy/100000", verified: true }, { title: "Legacy", url: "https://hh.ru/vacancy/100000", verified: true, reason: "already_applied" }]) }];
    expect((await request(`${importPath(a.workspaceId)}/preview`, a.token, "POST", { files, includeProfiles: true, acknowledgeWorkspaceVisibility: true })).status).toBe(409);
    await enable(a, "opportunities-profiles");
    let run = await preview(a, files, { includeProfiles: true, includeHistory: true }); run = (await apply(a, run)).data;
    expect(run.report.profilesCreated).toBe(1); expect(run.report.materialsCreated).toBe(1); expect(run.report.historyCreated).toBe(2); expect(run.report.possibleDuplicates).toBe(1);
    const rows = await prisma.withUser(a.userId, (tx) => tx.opportunityProfile.findMany({ where: { workspaceId: a.workspaceId } }));
    const profile = (await request<OpportunityProfileDetail>(`${profilePath(a.workspaceId)}/${rows[0].id}`, a.token)).data;
    expect(profile.facts).toEqual([]); expect(profile.materials.items).toHaveLength(1);
    run = (await apply(a, await preview(a, files, { includeProfiles: true, includeHistory: true }))).data;
    expect(run.report.materialsCreated).toBe(0); expect(run.report.historyCreated).toBe(0);
    const changedFiles = files.map((f) => f.path.endsWith(".md") ? { ...f, text: "Synthetic CV v2" } : f);
    run = (await apply(a, await preview(a, changedFiles, { includeProfiles: true }))).data;
    expect(run.report.profilesCreated).toBe(0); expect(run.report.materialsCreated).toBe(1);
    const history = await prisma.withUser(a.userId, (tx) => tx.opportunityHistory.findMany({ where: { workspaceId: a.workspaceId } }));
    expect(history.map((h) => h.outcome).sort()).toEqual(["already_exists", "legacy_claimed_verified"]); expect(history.every((h) => h.profileId === null)).toBe(true);
    const snapshotService = app.get(SnapshotService);
    const snapshot = await prisma.withUser(a.userId, (tx) => snapshotService.serialize(tx, a.workspaceId));
    expect(snapshot.tables.opportunityMaterials).toHaveLength(2);
    expect(snapshot.tables.opportunityCaptures).toHaveLength(1);
    await prisma.withUser(a.userId, (tx) => snapshotService.apply(tx, snapshot));
    const after = (await request<OpportunityProfileDetail>(`${profilePath(a.workspaceId)}/${rows[0].id}`, a.token)).data;
    expect(after.materials.items).toHaveLength(2); expect(after.tracks).toHaveLength(1); expect(after.facts).toEqual([]);
    expect(await prisma.withUser(a.userId, (tx) => tx.opportunityHistory.count({ where: { workspaceId: a.workspaceId } }))).toBe(2);
  });
  it("blocks foreign runs, owner-only history and resumes; cancels restored previews", async () => {
    const a = await register("backup-import"); const b = await register("foreign-import"); await enable(a, "opportunities-hh-import"); await enable(b, "opportunities-hh-import");
    const run = await preview(a);
    expect((await request(`${importPath(b.workspaceId)}/${run.id}`, b.token)).status).toBe(404);
    expect(await prisma.withUser(b.userId, (tx) => tx.opportunityImport.findMany({ where: { id: run.id } }))).toEqual([]);
    const service = app.get(SnapshotService);
    const snapshot = await prisma.withUser(a.userId, (tx) => service.serialize(tx, a.workspaceId));
    await prisma.withUser(a.userId, (tx) => service.apply(tx, snapshot));
    const restored = (await request<HhImportRun>(`${importPath(a.workspaceId)}/${run.id}`, a.token)).data;
    expect(restored.status).toBe("canceled"); expect(restored.revision).toBe(run.revision + 1); expect((await apply(a, run)).status).toBe(409);
    await prisma.asSystem((tx) => tx.workspaceMember.create({ data: { workspaceId: a.workspaceId, userId: b.userId, role: "member" } }));
    expect((await request(importPath(a.workspaceId), b.token)).status).toBe(403);
  });
});

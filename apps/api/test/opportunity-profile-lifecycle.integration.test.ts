import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HhHistoryPage, HhImportRun, OpportunityFact, OpportunityProfileDetail, OpportunityTrack } from "@orion/shared-types";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { SnapshotService } from "../src/sync/snapshot.service";

describe("Profile facts/tracks lifecycle and historical response log", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  const prefix = `lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
    return { token: res.data.accessToken, userId: res.data.user.id, workspaceId };
  }
  type Account = Awaited<ReturnType<typeof register>>;
  const profiles = (a: Account) => `/workspaces/${a.workspaceId}/opportunity-profiles`;
  const importer = (a: Account) => `/workspaces/${a.workspaceId}/opportunity-hh-import`;
  async function enable(a: Account, ...plugins: string[]) { for (const plugin of plugins) expect((await request(`/workspaces/${a.workspaceId}/plugins/${plugin}`, a.token, "PATCH", { enabled: true })).status).toBe(200); }
  async function newProfile(a: Account, name = "Synthetic person") {
    const r = await request<OpportunityProfileDetail>(profiles(a), a.token, "POST", { displayName: name, kind: "person", acknowledgeWorkspaceVisibility: true }); expect(r.status).toBe(201); return r.data;
  }
  async function newFact(a: Account, profileId: string, statement: string) {
    const r = await request<OpportunityFact>(`${profiles(a)}/${profileId}/facts`, a.token, "POST", { statement, source: "synthetic note" }); expect(r.status).toBe(201); return r.data;
  }

  it("edits and archives facts: edit resets confirmation, CAS holds, archived facts leave tracks' choices", async () => {
    const a = await register("facts"); const b = await register("foreign"); await enable(a, "opportunities-profiles"); await enable(b, "opportunities-profiles");
    const p = await newProfile(a);
    const fact = await newFact(a, p.id, "Synthetic: led a team of five");
    const confirmed = await request<OpportunityFact>(`${profiles(a)}/${p.id}/facts/${fact.id}`, a.token, "PATCH", { expectedRevision: fact.revision, state: "confirmed" });
    expect(confirmed.data.state).toBe("confirmed"); expect(confirmed.data.confirmedBy).toBe(a.userId);

    const path = `${profiles(a)}/${p.id}/facts/${fact.id}`;
    expect((await request(`${path}/content`, a.token, "PATCH", { expectedRevision: confirmed.data.revision })).status).toBe(400);
    const edited = await request<OpportunityFact>(`${path}/content`, a.token, "PATCH", { expectedRevision: confirmed.data.revision, statement: "Synthetic: led a team of six" });
    expect(edited.status).toBe(200);
    expect(edited.data).toMatchObject({ statement: "Synthetic: led a team of six", state: "unverified", confirmedBy: null, confirmedAt: null });
    // стейл-ревизия не перезаписывает молча
    expect((await request(`${path}/content`, a.token, "PATCH", { expectedRevision: confirmed.data.revision, source: "other" })).status).toBe(409);
    // чужое пространство не видит и не меняет
    expect((await request(`${path}/content`, b.token, "PATCH", { expectedRevision: edited.data.revision, source: "x" })).status).toBe(403);

    const track = await request<OpportunityTrack>(`${profiles(a)}/${p.id}/tracks`, a.token, "POST", { name: "Analyst", factIds: [fact.id] });
    expect(track.status).toBe(201); expect(track.data).toMatchObject({ revision: 0, archivedAt: null });

    const archived = await request<OpportunityFact>(`${path}/archive`, a.token, "POST", { expectedRevision: edited.data.revision, archived: true });
    expect(archived.data.archivedAt).not.toBeNull();
    expect((await request(`${path}`, a.token, "PATCH", { expectedRevision: archived.data.revision, state: "confirmed" })).status).toBe(409);
    expect((await request(`${path}/content`, a.token, "PATCH", { expectedRevision: archived.data.revision, source: "x" })).status).toBe(409);
    // архивный факт нельзя добавить в новый трек, но данные не потеряны
    expect((await request(`${profiles(a)}/${p.id}/tracks`, a.token, "POST", { name: "Other", factIds: [fact.id] })).status).toBe(404);
    const detail = await request<OpportunityProfileDetail>(`${profiles(a)}/${p.id}`, a.token);
    expect(detail.data.facts.find((f) => f.id === fact.id)?.archivedAt).not.toBeNull();
    const restored = await request<OpportunityFact>(`${path}/archive`, a.token, "POST", { expectedRevision: archived.data.revision, archived: false });
    expect(restored.data).toMatchObject({ archivedAt: null, state: "unverified", statement: "Synthetic: led a team of six" });
  });

  it("updates and archives tracks with CAS; archived tracks accept no new materials; member cannot manage", async () => {
    const a = await register("tracks"); await enable(a, "opportunities-profiles");
    const p = await newProfile(a);
    const f1 = await newFact(a, p.id, "Fact one"); const f2 = await newFact(a, p.id, "Fact two");
    const track = (await request<OpportunityTrack>(`${profiles(a)}/${p.id}/tracks`, a.token, "POST", { name: "Track", factIds: [f1.id] })).data;
    const path = `${profiles(a)}/${p.id}/tracks/${track.id}`;
    expect((await request(path, a.token, "PATCH", { expectedRevision: 0 })).status).toBe(400);
    const race = await Promise.all([
      request<OpportunityTrack>(path, a.token, "PATCH", { expectedRevision: 0, name: "Renamed" }),
      request<OpportunityTrack>(path, a.token, "PATCH", { expectedRevision: 0, factIds: [f1.id, f2.id] })
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
    const current = (await request<OpportunityProfileDetail>(`${profiles(a)}/${p.id}`, a.token)).data.tracks.find((t) => t.id === track.id)!;
    expect(current.revision).toBe(1);
    // чужой/несуществующий факт
    expect((await request(path, a.token, "PATCH", { expectedRevision: 1, factIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(404);

    const archived = await request<OpportunityTrack>(`${path}/archive`, a.token, "POST", { expectedRevision: 1, archived: true });
    expect(archived.data.archivedAt).not.toBeNull();
    expect((await request(path, a.token, "PATCH", { expectedRevision: 2, name: "x" })).status).toBe(409);
    const material = await request(`${profiles(a)}/${p.id}/materials`, a.token, "POST", { title: "V", content: "text", type: "resume", trackId: track.id });
    expect(material.status).toBe(404);
    const back = await request<OpportunityTrack>(`${path}/archive`, a.token, "POST", { expectedRevision: 2, archived: false });
    expect(back.data.archivedAt).toBeNull();
    expect((await request(`${profiles(a)}/${p.id}/materials`, a.token, "POST", { title: "V", content: "text", type: "resume", trackId: track.id })).status).toBe(201);
  });

  it("imports PDF-style extracted text, cover letters as proposals, rejects missing/failed extraction; history log pages, filters and keeps legacy verified unconfirmed", async () => {
    const a = await register("history"); await enable(a, "opportunities-profiles", "opportunities-hh-import");
    const ok = { format: "docx", status: "ok", parser: "orion-docx-xml@1", reason: "" };
    const preview = await request<HhImportRun>(`${importer(a)}/preview`, a.token, "POST", {
      acknowledgeWorkspaceVisibility: true, includeProfiles: true, includeHistory: true,
      files: [
        { path: "HH/Ivan/Резюме/Analyst.docx", text: "Synthetic analyst resume", extraction: ok },
        { path: "HH/Ivan/Cover_Letters/Letter.docx", text: "Synthetic cover letter", extraction: ok },
        { path: "HH/Ivan/Резюме/Broken.pdf", text: "", extraction: { format: "pdf", status: "corrupt", parser: "-", reason: "PDF повреждён" } },
        { path: "HH/Ivan/Резюме/Raw.pdf", text: "%PDF raw bytes" },
        { path: "applications/log.json", text: JSON.stringify([
          { title: "Linked A", url: "https://hh.ru/vacancy/9001", verified: true },
          { title: "Orphan B", reason: "already_applied" },
          { title: "Orphan C", success: false }
        ]) },
        { path: "vacancies_one.json", text: JSON.stringify([{ title: "Linked A", url: "https://hh.ru/vacancy/9001", description: "x" }]) }
      ]
    });
    expect(preview.status).toBe(201);
    expect(preview.data.preview.warnings.map((w) => w.code).sort()).toEqual(["corrupt", "extraction_missing"]);
    let run = preview.data;
    while (run.status !== "applied") {
      const next = await request<HhImportRun>(`${importer(a)}/${run.id}/apply`, a.token, "POST", { expectedRevision: run.revision, manifestHash: run.manifestHash });
      expect(next.status).toBe(201); run = next.data;
    }
    const plist = await request<{ items: { id: string }[] }>(profiles(a), a.token);
    const materials = await request<{ items: { title: string; type: string }[] }>(`${profiles(a)}/${plist.data.items[0].id}/materials`, a.token);
    expect(materials.data.items.map((m) => `${m.title}:${m.type}`).sort()).toEqual(["Analyst:resume", "Letter:proposal"]);

    const log = await request<HhHistoryPage>(`${importer(a)}/history`, a.token);
    expect(log.status).toBe(200);
    expect(log.data.totals).toMatchObject({ all: 3, unlinked: 2, possibleDuplicates: 0 });
    expect(log.data.totals.byOutcome).toEqual({ legacy_claimed_verified: 1, already_exists: 1, failed: 1 });
    expect(JSON.stringify(log.data)).not.toContain('"confirmed"');
    const unlinked = await request<HhHistoryPage>(`${importer(a)}/history?unlinked=true`, a.token);
    expect(unlinked.data.items.map((i) => i.title).sort()).toEqual(["Orphan B", "Orphan C"]);
    expect(unlinked.data.items.every((i) => i.opportunityId === null)).toBe(true);
    const failed = await request<HhHistoryPage>(`${importer(a)}/history?outcome=failed`, a.token);
    expect(failed.data.items.map((i) => i.title)).toEqual(["Orphan C"]);
    expect((await request(`${importer(a)}/history?outcome=bogus`, a.token)).status).toBe(400);

    // курсор постраничный и стабильный, чужой курсор не принимается
    const first = await request<HhHistoryPage>(`${importer(a)}/history`, a.token);
    expect(first.data.nextCursor).toBeNull();
    expect((await request(`${importer(a)}/history?cursor=00000000-0000-4000-8000-000000000000`, a.token)).status).toBe(404);

    // другой пользователь: журнал виден только владельцу своего пространства и не пересекается
    const other = await register("other"); await enable(other, "opportunities-hh-import");
    expect((await request<HhHistoryPage>(`${importer(other)}/history`, other.token)).data.totals.all).toBe(0);
    expect((await request(`${importer(a)}/history`, other.token)).status).toBe(403);
  });

  it("restores facts/tracks lifecycle columns from a snapshot", async () => {
    const a = await register("snapshot"); await enable(a, "opportunities-profiles");
    const p = await newProfile(a);
    const fact = await newFact(a, p.id, "Archived fact");
    const track = (await request<OpportunityTrack>(`${profiles(a)}/${p.id}/tracks`, a.token, "POST", { name: "T", factIds: [] })).data;
    await request(`${profiles(a)}/${p.id}/facts/${fact.id}/archive`, a.token, "POST", { expectedRevision: 0, archived: true });
    await request(`${profiles(a)}/${p.id}/tracks/${track.id}/archive`, a.token, "POST", { expectedRevision: 0, archived: true });
    const snapshots = app.get(SnapshotService);
    const dump = await prisma.withUser(a.userId, (tx) => snapshots.serialize(tx, a.workspaceId));
    await prisma.withUser(a.userId, (tx) => snapshots.apply(tx, dump));
    const detail = await request<OpportunityProfileDetail>(`${profiles(a)}/${p.id}`, a.token);
    expect(detail.data.facts[0].archivedAt).not.toBeNull();
    expect(detail.data.tracks[0]).toMatchObject({ revision: 1 });
    expect(detail.data.tracks[0].archivedAt).not.toBeNull();
  });
});

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OpportunityProfileDetail, HhImportRun } from "@orion/shared-types";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { SnapshotService } from "../src/sync/snapshot.service";

describe("Profile active resume: explicit immutable choice", () => {
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

  const profilesPath = (ws: string) => `/workspaces/${ws}/opportunity-profiles`;
  async function enable(a: Awaited<ReturnType<typeof register>>, plugin = "opportunities-profiles") { expect((await request(`/workspaces/${a.workspaceId}/plugins/${plugin}`, a.token, "PATCH", { enabled: true })).status).toBe(200); }
  async function profile(a: Awaited<ReturnType<typeof register>>, name: string) {
    const result = await request<OpportunityProfileDetail>(profilesPath(a.workspaceId), a.token, "POST", { displayName: name, kind: "team", acknowledgeWorkspaceVisibility: true }); expect(result.status).toBe(201); return result.data;
  }
  async function material(a: Awaited<ReturnType<typeof register>>, id: string, title: string, type = "resume") {
    const result = await request<{id:string}>(`${profilesPath(a.workspaceId)}/${id}/materials`, a.token, "POST", { title, content: "Synthetic text", type }); expect(result.status).toBe(201); return result.data;
  }
  async function select(a: Awaited<ReturnType<typeof register>>, id: string, materialId: string | null, expectedRevision: number) { return request<OpportunityProfileDetail>(`${profilesPath(a.workspaceId)}/${id}/active-resume`, a.token, "POST", { materialId, expectedRevision }); }
  it("checks type/ownership, rejects CAS races, preserves selection through settings/archive/disable/backup", async () => {
    const a = await register("selection"); const b = await register("foreign"); await enable(a); await enable(b);
    const p = await profile(a, "Synthetic team"); const other = await profile(a, "Other");
    expect(p.activeResumeMaterialId).toBeNull();
    const v1 = await material(a, p.id, "V1"); const v2 = await material(a, p.id, "V2"); const portfolio = await material(a, p.id, "Portfolio", "portfolio"); const foreign = await material(a, other.id, "Foreign");
    expect((await select(a, p.id, portfolio.id, 0)).status).toBe(404);
    expect((await select(a, p.id, foreign.id, 0)).status).toBe(404);
    expect((await select(b, p.id, v1.id, 0)).status).toBe(404);
    expect((await select(a, p.id, v1.id, 99)).status).toBe(409);
    const race = await Promise.all([select(a, p.id, v1.id, 0), select(a, p.id, v2.id, 0)]);
    expect(race.map(r => r.status).sort()).toEqual([201,409]);
    const winner = race.find(r => r.status===201)!.data;
    expect([v1.id,v2.id]).toContain(winner.activeResumeMaterialId);
    const path = `${profilesPath(a.workspaceId)}/${p.id}`;
    const changed = await request<OpportunityProfileDetail>(path, a.token, "PATCH", { expectedRevision: 1, preferences: { city: "Kazan" } });
    expect(changed.data.activeResumeMaterialId).toBe(winner.activeResumeMaterialId);
    expect((changed.data.preferences as unknown as Record<string,unknown>)._activeResumeMaterialId).toBeUndefined();
    expect((await request(path, a.token, "PATCH", { expectedRevision: 2, preferences: { _activeResumeMaterialId: foreign.id } })).status).toBe(400);
    const archived = await request<OpportunityProfileDetail>(path, a.token, "PATCH", { expectedRevision: 2, archivedAt: new Date().toISOString() });
    expect((await select(a, p.id, null, archived.data.revision)).status).toBe(409);
    await request(path, a.token, "PATCH", { expectedRevision: 3, archivedAt: null });
    await request(`/workspaces/${a.workspaceId}/plugins/opportunities-profiles`, a.token, "PATCH", { enabled: false });
    expect((await select(a, p.id, null, 4)).status).toBe(409); await enable(a);
    const service = app.get(SnapshotService); const snapshot = await prisma.withUser(a.userId, tx => service.serialize(tx, a.workspaceId));
    expect((await select(a, p.id, null, 4)).data.activeResumeMaterialId).toBeNull();
    await prisma.withUser(a.userId, tx => service.apply(tx, snapshot));
    const restored = (await request<OpportunityProfileDetail>(path, a.token)).data;
    expect(restored.activeResumeMaterialId).toBe(winner.activeResumeMaterialId); expect(restored.activeResume?.id).toBe(winner.activeResumeMaterialId); expect(restored.materials.items).toHaveLength(3);
    await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: a.workspaceId, userId: b.userId, role: "member" } }));
    expect((await request<OpportunityProfileDetail>(path, b.token)).data.activeResume?.id).toBe(winner.activeResumeMaterialId);
    expect((await request(`${path}/active-resume`, b.token, "POST", { materialId: null, expectedRevision: restored.revision })).status).toBe(403);
  });
  it("resolves selected metadata beyond pagination, keeps import from selecting a new version, clears without deleting", async () => {
    const a = await register("pages"); await enable(a); await enable(a,"opportunities-hh-import");
    const p = await profile(a,"Page test"); const selectedId = "ffffffff-ffff-4fff-afff-ffffffffffff";
    await prisma.withUser(a.userId, tx => tx.opportunityMaterial.createMany({ data: Array.from({length:52},(_,i)=>({id:i===51?selectedId:`00000000-0000-4000-a000-${String(i).padStart(12,"0")}`, workspaceId:a.workspaceId,profileId:p.id,title:`V${i}`,type:"resume",content:"Synthetic",contentHash:"a".repeat(64),sourceKey:`test:${i}`})) }));
    expect((await select(a,p.id,selectedId,0)).status).toBe(201);
    const path = `${profilesPath(a.workspaceId)}/${p.id}`;
    const detail = (await request<OpportunityProfileDetail>(path,a.token)).data;
    expect(detail.materials.items).toHaveLength(50); expect(detail.materials.items.some(m=>m.id===selectedId)).toBe(false); expect(detail.activeResume?.id).toBe(selectedId);
    const preview = await request<HhImportRun>(`/workspaces/${a.workspaceId}/opportunity-hh-import/preview`,a.token,"POST",{files:[{path:"Imported/Резюме/Test.md",text:"Synthetic imported CV"}],includeProfiles:true,acknowledgeWorkspaceVisibility:true});
    expect(preview.status).toBe(201);
    const run = preview.data; expect((await request(`/workspaces/${a.workspaceId}/opportunity-hh-import/${run.id}/apply`,a.token,"POST",{manifestHash:run.manifestHash,expectedRevision:run.revision})).status).toBe(201);
    expect((await request<OpportunityProfileDetail>(path,a.token)).data.activeResumeMaterialId).toBe(selectedId);
    const imported = await prisma.withUser(a.userId,tx=>tx.opportunityProfile.findFirstOrThrow({where:{workspaceId:a.workspaceId,sourceKey:"hh-folder:Imported"}}));
    const importedPath = `${profilesPath(a.workspaceId)}/${imported.id}`;
    const importedDetail = (await request<OpportunityProfileDetail>(importedPath,a.token)).data;
    expect(importedDetail.activeResumeMaterialId).toBeNull();
    const importedMaterial = importedDetail.materials.items[0];
    expect((await select(a,imported.id,importedMaterial.id,0)).status).toBe(201);
    const nextPreview = await request<HhImportRun>(`/workspaces/${a.workspaceId}/opportunity-hh-import/preview`,a.token,"POST",{files:[{path:"Imported/Резюме/Test.md",text:"Synthetic CV v2"}],includeProfiles:true,acknowledgeWorkspaceVisibility:true});
    await request(`/workspaces/${a.workspaceId}/opportunity-hh-import/${nextPreview.data.id}/apply`,a.token,"POST",{manifestHash:nextPreview.data.manifestHash,expectedRevision:0});
    expect((await request<OpportunityProfileDetail>(importedPath,a.token)).data.activeResumeMaterialId).toBe(importedMaterial.id);
    expect((await select(a,p.id,null,1)).data.activeResumeMaterialId).toBeNull();
    expect(await prisma.withUser(a.userId,tx=>tx.opportunityMaterial.count({where:{profileId:p.id,workspaceId:a.workspaceId}}))).toBe(52);
  });
});

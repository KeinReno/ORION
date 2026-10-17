import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { OpportunityProfile as ProfileRow, OpportunityFact as FactRow, OpportunityTrack as TrackRow, OpportunityMaterial as MaterialRow, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { opportunityProfileSchema, opportunityFactSchema, opportunityTrackSchema, opportunityMaterialSchema, profilePreferencesSchema, type CreateOpportunityProfileInput, type UpdateOpportunityProfileInput, type CreateOpportunityFactInput, type SetOpportunityFactStateInput, type CreateOpportunityTrackInput, type CreateOpportunityMaterialInput } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { PluginsService } from "../plugins/plugins.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { ProfileImportMaterial, ProfileImportPort } from "./import-contract";
import type { ProfileEvidence, ProfileEvidencePort } from "./evidence-contract";
import type { SelectOpportunityResumeInput, UpdateOpportunityFactInput, ArchiveOpportunityItemInput, UpdateOpportunityTrackInput } from "@orion/shared-types";

// Reserved profile setting; existing snapshots preserve this JSON without a schema migration.
function settings(row: ProfileRow): Prisma.JsonObject { return row.preferences && typeof row.preferences === "object" && !Array.isArray(row.preferences) ? row.preferences : {}; }
function activeResumeId(row: ProfileRow): string | null { const id = settings(row)._activeResumeMaterialId; return typeof id === "string" ? id : null; }

export function profileDto(row: ProfileRow) { return opportunityProfileSchema.parse({ id: row.id, workspaceId: row.workspaceId, displayName: row.displayName, kind: row.kind, ownerUserId: row.ownerUserId, sourceKey: row.sourceKey, preferences: row.preferences, activeResumeMaterialId: activeResumeId(row), revision: row.revision, archivedAt: row.archivedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }); }
export function factDto(row: FactRow) { return opportunityFactSchema.parse({ id: row.id, profileId: row.profileId, statement: row.statement, category: row.category, source: row.source, state: row.state, revision: row.revision, confirmedBy: row.confirmedBy, confirmedAt: row.confirmedAt?.toISOString() ?? null, archivedAt: row.archivedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() }); }
export function trackDto(row: TrackRow) { return opportunityTrackSchema.parse({ id: row.id, profileId: row.profileId, name: row.name, factIds: row.factIds, sourceKey: row.sourceKey, revision: row.revision, archivedAt: row.archivedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() }); }
export function materialDto(row: MaterialRow) { return opportunityMaterialSchema.parse({ id: row.id, profileId: row.profileId, trackId: row.trackId, title: row.title, type: row.type, contentHash: row.contentHash, sourcePath: row.sourcePath, sourceKey: row.sourceKey, createdAt: row.createdAt.toISOString() }); }
function hash(content: string) { return createHash("sha256").update(content).digest("hex"); }

@Injectable()
export class ProfilesService implements ProfileImportPort, ProfileEvidencePort {
  constructor(private readonly prisma: PrismaService, private readonly plugins: PluginsService, private readonly workspaces: WorkspacesService) {}
  private async guard(tx: Prisma.TransactionClient, userId: string, ws: string, write = false) {
    if (write) await this.workspaces.assertMemberRoleTx(tx, userId, ws, ["owner"]); else await this.workspaces.assertMemberTx(tx, userId, ws);
    await this.plugins.assertEnabledTx(tx, userId, ws, "opportunities-profiles");
  }
  private async owned(tx: Prisma.TransactionClient, ws: string, id: string, active = false) {
    const row = await tx.opportunityProfile.findFirst({ where: { id, workspaceId: ws } });
    if (!row) throw new NotFoundException("Профиль не найден");
    if (active && row.archivedAt) throw new ConflictException("Профиль в архиве. Сначала восстановите его.");
    return row;
  }
  async list(userId: string, ws: string, cursor?: string, includeArchived = false) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws); if (cursor) await this.owned(tx, ws, cursor);
      const rows = await tx.opportunityProfile.findMany({ where: { workspaceId: ws, ...(includeArchived ? {} : { archivedAt: null }) }, orderBy: { id: "asc" }, take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      return { items: rows.slice(0, 50).map(profileDto), nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  }
  async create(userId: string, ws: string, input: CreateOpportunityProfileInput) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws, true);
      return profileDto(await tx.opportunityProfile.create({ data: { workspaceId: ws, ownerUserId: userId, displayName: input.displayName, kind: input.kind, preferences: input.preferences } }));
    });
  }
  async update(userId: string, ws: string, id: string, input: UpdateOpportunityProfileInput) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws, true); const current = await this.owned(tx, ws, id);
      if (current.revision !== input.expectedRevision) throw new ConflictException("Профиль изменён в другом окне. Обновите данные.");
      const { expectedRevision, archivedAt, ...data } = input;
      const changed = await tx.opportunityProfile.updateMany({ where: { id, workspaceId: ws, revision: expectedRevision }, data: { ...data, ...(data.preferences ? { preferences: { ...settings(current), ...data.preferences } as Prisma.InputJsonObject } : {}), revision: { increment: 1 }, ...(archivedAt !== undefined ? { archivedAt: archivedAt ? new Date(archivedAt) : null } : {}) } });
      if (!changed.count) throw new ConflictException("Профиль изменён в другом окне. Обновите данные.");
      return profileDto(await this.owned(tx, ws, id));
    });
  }
  async detail(userId: string, ws: string, id: string) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws); const profile = await this.owned(tx, ws, id);
      const facts = await tx.opportunityFact.findMany({ where: { workspaceId: ws, profileId: id }, orderBy: { createdAt: "asc" } });
      const tracks = await tx.opportunityTrack.findMany({ where: { workspaceId: ws, profileId: id }, orderBy: { createdAt: "asc" } });
      const activeId = activeResumeId(profile);
      const active = activeId ? await tx.opportunityMaterial.findFirst({ where: { id: activeId, workspaceId: ws, profileId: id, type: "resume" } }) : null;
      return { ...profileDto(profile), activeResume: active ? materialDto(active) : null, facts: facts.map(factDto), tracks: tracks.map(trackDto), materials: await this.materialPageTx(tx, ws, id) };
    });
  }
  async selectResume(userId: string, ws: string, id: string, input: SelectOpportunityResumeInput) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws, true);
      const current = await this.owned(tx, ws, id, true);
      if (current.revision !== input.expectedRevision) throw new ConflictException("Профиль изменён в другом окне. Обновите данные перед выбором резюме.");
      if (input.materialId && !await tx.opportunityMaterial.findFirst({ where: { id: input.materialId, workspaceId: ws, profileId: id, type: "resume" } })) throw new NotFoundException("Версия резюме не принадлежит этому профилю");
      const changed = await tx.opportunityProfile.updateMany({ where: { id, workspaceId: ws, revision: input.expectedRevision }, data: { preferences: { ...settings(current), _activeResumeMaterialId: input.materialId } as Prisma.InputJsonObject, revision: { increment: 1 } } });
      if (!changed.count) throw new ConflictException("Профиль изменён в другом окне. Обновите данные перед выбором резюме.");
      return profileDto(await this.owned(tx, ws, id));
    });
  }
  async addFact(userId: string, ws: string, id: string, input: CreateOpportunityFactInput) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws, true); await this.owned(tx, ws, id, true);
      if (await tx.opportunityFact.count({ where: { profileId: id, workspaceId: ws } }) >= 500) throw new BadRequestException("В профиле уже 500 фактов");
      return factDto(await tx.opportunityFact.create({ data: { ...input, workspaceId: ws, profileId: id } }));
    });
  }
  async factState(userId: string, ws: string, id: string, factId: string, input: SetOpportunityFactStateInput) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws, true); await this.owned(tx, ws, id, true);
      const fact = await tx.opportunityFact.findFirst({ where: { id: factId, profileId: id, workspaceId: ws } });
      if (!fact) throw new NotFoundException("Факт не найден");
      if (fact.archivedAt) throw new ConflictException("Факт в архиве. Сначала верните его из архива.");
      const changed = await tx.opportunityFact.updateMany({ where: { id: factId, workspaceId: ws, profileId: id, revision: input.expectedRevision }, data: { state: input.state, revision: { increment: 1 }, confirmedBy: input.state === "confirmed" ? userId : null, confirmedAt: input.state === "confirmed" ? new Date() : null } });
      if (!changed.count) throw new ConflictException("Факт изменён. Обновите данные.");
      return factDto(await tx.opportunityFact.findUniqueOrThrow({ where: { id: factId } }));
    });
  }
  async addTrack(userId: string, ws: string, id: string, input: CreateOpportunityTrackInput) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws, true); await this.owned(tx, ws, id, true);
      if (input.factIds.length && await tx.opportunityFact.count({ where: { id: { in: input.factIds }, profileId: id, workspaceId: ws, archivedAt: null } }) !== input.factIds.length) throw new NotFoundException("Один из фактов не принадлежит этому профилю или находится в архиве");
      return trackDto(await tx.opportunityTrack.create({ data: { workspaceId: ws, profileId: id, name: input.name, factIds: input.factIds, sourceKey: `manual:${randomUUID()}` } }));
    });
  }
  async updateFact(userId: string, ws: string, id: string, factId: string, input: UpdateOpportunityFactInput) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws, true); await this.owned(tx, ws, id, true);
      const fact = await tx.opportunityFact.findFirst({ where: { id: factId, profileId: id, workspaceId: ws } });
      if (!fact) throw new NotFoundException("Факт не найден");
      if (fact.archivedAt) throw new ConflictException("Факт в архиве. Сначала верните его из архива.");
      const { expectedRevision, ...fields } = input;
      // Изменённая формулировка или источник — уже другое утверждение: прежнее подтверждение владельца к нему не относится.
      const changed = await tx.opportunityFact.updateMany({ where: { id: factId, workspaceId: ws, profileId: id, revision: expectedRevision }, data: { ...fields, state: "unverified", confirmedBy: null, confirmedAt: null, revision: { increment: 1 } } });
      if (!changed.count) throw new ConflictException("Факт изменён. Обновите данные.");
      return factDto(await tx.opportunityFact.findUniqueOrThrow({ where: { id: factId } }));
    });
  }
  async archiveFact(userId: string, ws: string, id: string, factId: string, input: ArchiveOpportunityItemInput) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws, true); await this.owned(tx, ws, id, true);
      if (!await tx.opportunityFact.findFirst({ where: { id: factId, profileId: id, workspaceId: ws } })) throw new NotFoundException("Факт не найден");
      const changed = await tx.opportunityFact.updateMany({ where: { id: factId, workspaceId: ws, profileId: id, revision: input.expectedRevision }, data: { archivedAt: input.archived ? new Date() : null, revision: { increment: 1 } } });
      if (!changed.count) throw new ConflictException("Факт изменён. Обновите данные.");
      return factDto(await tx.opportunityFact.findUniqueOrThrow({ where: { id: factId } }));
    });
  }
  async updateTrack(userId: string, ws: string, id: string, trackId: string, input: UpdateOpportunityTrackInput) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws, true); await this.owned(tx, ws, id, true);
      const track = await tx.opportunityTrack.findFirst({ where: { id: trackId, profileId: id, workspaceId: ws } });
      if (!track) throw new NotFoundException("Трек не найден");
      if (track.archivedAt) throw new ConflictException("Трек в архиве. Сначала верните его из архива.");
      if (input.factIds) {
        const kept = new Set(Array.isArray(track.factIds) ? (track.factIds as string[]) : []);
        const fresh = input.factIds.filter((fid) => !kept.has(fid));
        if (fresh.length && await tx.opportunityFact.count({ where: { id: { in: fresh }, profileId: id, workspaceId: ws, archivedAt: null } }) !== fresh.length) throw new NotFoundException("Один из фактов не принадлежит этому профилю или находится в архиве");
      }
      const changed = await tx.opportunityTrack.updateMany({ where: { id: trackId, workspaceId: ws, profileId: id, revision: input.expectedRevision }, data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.factIds ? { factIds: input.factIds } : {}), revision: { increment: 1 } } });
      if (!changed.count) throw new ConflictException("Трек изменён. Обновите данные.");
      return trackDto(await tx.opportunityTrack.findUniqueOrThrow({ where: { id: trackId } }));
    });
  }
  async archiveTrack(userId: string, ws: string, id: string, trackId: string, input: ArchiveOpportunityItemInput) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws, true); await this.owned(tx, ws, id, true);
      if (!await tx.opportunityTrack.findFirst({ where: { id: trackId, profileId: id, workspaceId: ws } })) throw new NotFoundException("Трек не найден");
      const changed = await tx.opportunityTrack.updateMany({ where: { id: trackId, workspaceId: ws, profileId: id, revision: input.expectedRevision }, data: { archivedAt: input.archived ? new Date() : null, revision: { increment: 1 } } });
      if (!changed.count) throw new ConflictException("Трек изменён. Обновите данные.");
      return trackDto(await tx.opportunityTrack.findUniqueOrThrow({ where: { id: trackId } }));
    });
  }
  async addMaterial(userId: string, ws: string, id: string, input: CreateOpportunityMaterialInput) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws, true); await this.owned(tx, ws, id, true);
      if (input.trackId && !await tx.opportunityTrack.findFirst({ where: { id: input.trackId, profileId: id, workspaceId: ws, archivedAt: null } })) throw new NotFoundException("Трек не принадлежит этому профилю или находится в архиве");
      return materialDto(await tx.opportunityMaterial.create({ data: { ...input, workspaceId: ws, profileId: id, contentHash: hash(input.content), sourceKey: `manual:${randomUUID()}` } }));
    });
  }
  private async materialPageTx(tx: Prisma.TransactionClient, ws: string, id: string, cursor?: string) {
    if (cursor && !await tx.opportunityMaterial.findFirst({ where: { id: cursor, workspaceId: ws, profileId: id } })) throw new NotFoundException("Версия не найдена");
    const rows = await tx.opportunityMaterial.findMany({ where: { workspaceId: ws, profileId: id }, orderBy: { id: "asc" }, take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    return { items: rows.slice(0, 50).map(materialDto), nextCursor: rows.length > 50 ? rows[49].id : null };
  }
  async materials(userId: string, ws: string, id: string, cursor?: string) { return this.prisma.withUser(userId, async (tx) => { await this.guard(tx, userId, ws); await this.owned(tx, ws, id); return this.materialPageTx(tx, ws, id, cursor); }); }
  async material(userId: string, ws: string, id: string, materialId: string) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws); await this.owned(tx, ws, id);
      const row = await tx.opportunityMaterial.findFirst({ where: { id: materialId, profileId: id, workspaceId: ws } });
      if (!row) throw new NotFoundException("Версия не найдена"); return { ...materialDto(row), content: row.content };
    });
  }
  async readEvidenceTx(tx: Prisma.TransactionClient, userId: string, ws: string, profileId: string): Promise<ProfileEvidence> {
    await this.guard(tx, userId, ws);
    const profile = await this.owned(tx, ws, profileId);
    const facts = await tx.opportunityFact.findMany({ where: { workspaceId: ws, profileId, archivedAt: null }, orderBy: { id: "asc" } });
    const tracks = await tx.opportunityTrack.findMany({ where: { workspaceId: ws, profileId, archivedAt: null }, orderBy: { id: "asc" } });
    const activeId = activeResumeId(profile);
    const resume = activeId ? await tx.opportunityMaterial.findFirst({ where: { id: activeId, workspaceId: ws, profileId, type: "resume" } }) : null;
    const dtoProfile = profileDto(profile);
    return {
      profile: { id: profile.id, revision: profile.revision, displayName: profile.displayName, kind: dtoProfile.kind, archivedAt: dtoProfile.archivedAt, preferences: dtoProfile.preferences },
      facts: facts.map((f) => ({ id: f.id, statement: f.statement, category: f.category, source: f.source, state: factDto(f).state, revision: f.revision })),
      tracks: tracks.map((t) => ({ id: t.id, name: t.name })),
      activeResume: resume ? { id: resume.id, title: resume.title, type: resume.type, contentHash: resume.contentHash, content: resume.content } : null
    };
  }
  async assertImportTargetTx(tx: Prisma.TransactionClient, userId: string, ws: string, id: string) { await this.guard(tx, userId, ws, true); await this.owned(tx, ws, id, true); }
  async importMaterialTx(tx: Prisma.TransactionClient, userId: string, ws: string, input: ProfileImportMaterial) {
    await this.guard(tx, userId, ws, true);
    const profileCreated = await tx.opportunityProfile.createMany({ skipDuplicates: true, data: [{ id: randomUUID(), workspaceId: ws, displayName: input.candidateName, kind: "person", ownerUserId: userId, sourceKey: input.profileSourceKey, preferences: profilePreferencesSchema.parse({}) }] });
    const profile = await tx.opportunityProfile.findUniqueOrThrow({ where: { workspaceId_sourceKey: { workspaceId: ws, sourceKey: input.profileSourceKey } } });
    if (profile.archivedAt) throw new ConflictException(`Профиль «${profile.displayName}» в архиве. Восстановите его перед импортом.`);
    const trackKey = input.sourceKey;
    await tx.opportunityTrack.createMany({ skipDuplicates: true, data: [{ id: randomUUID(), workspaceId: ws, profileId: profile.id, name: input.title, sourceKey: trackKey, factIds: [] }] });
    const track = await tx.opportunityTrack.findUniqueOrThrow({ where: { workspaceId_profileId_sourceKey: { workspaceId: ws, profileId: profile.id, sourceKey: trackKey } } });
    const materialCreated = await tx.opportunityMaterial.createMany({ skipDuplicates: true, data: [{ id: randomUUID(), workspaceId: ws, profileId: profile.id, trackId: track.id, title: input.title, type: input.type ?? "resume", content: input.content, contentHash: hash(input.content), sourceKey: input.sourceKey, sourcePath: input.sourcePath }] });
    return { profileId: profile.id, profileCreated: profileCreated.count === 1, materialCreated: materialCreated.count === 1 };
  }
}

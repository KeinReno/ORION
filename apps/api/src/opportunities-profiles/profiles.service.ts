import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { OpportunityProfile as ProfileRow, OpportunityFact as FactRow, OpportunityTrack as TrackRow, OpportunityMaterial as MaterialRow, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { opportunityProfileSchema, opportunityFactSchema, opportunityTrackSchema, opportunityMaterialSchema, profilePreferencesSchema, type CreateOpportunityProfileInput, type UpdateOpportunityProfileInput, type CreateOpportunityFactInput, type SetOpportunityFactStateInput, type CreateOpportunityTrackInput, type CreateOpportunityMaterialInput } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { PluginsService } from "../plugins/plugins.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { ProfileImportMaterial, ProfileImportPort } from "./import-contract";

export function profileDto(row: ProfileRow) { return opportunityProfileSchema.parse({ id: row.id, workspaceId: row.workspaceId, displayName: row.displayName, kind: row.kind, ownerUserId: row.ownerUserId, sourceKey: row.sourceKey, preferences: row.preferences, revision: row.revision, archivedAt: row.archivedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }); }
export function factDto(row: FactRow) { return opportunityFactSchema.parse({ id: row.id, profileId: row.profileId, statement: row.statement, category: row.category, source: row.source, state: row.state, revision: row.revision, confirmedBy: row.confirmedBy, confirmedAt: row.confirmedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() }); }
export function trackDto(row: TrackRow) { return opportunityTrackSchema.parse({ id: row.id, profileId: row.profileId, name: row.name, factIds: row.factIds, sourceKey: row.sourceKey, createdAt: row.createdAt.toISOString() }); }
export function materialDto(row: MaterialRow) { return opportunityMaterialSchema.parse({ id: row.id, profileId: row.profileId, trackId: row.trackId, title: row.title, type: row.type, contentHash: row.contentHash, sourcePath: row.sourcePath, sourceKey: row.sourceKey, createdAt: row.createdAt.toISOString() }); }
function hash(content: string) { return createHash("sha256").update(content).digest("hex"); }

@Injectable()
export class ProfilesService implements ProfileImportPort {
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
      await this.guard(tx, userId, ws, true); await this.owned(tx, ws, id);
      const { expectedRevision, archivedAt, ...data } = input;
      const changed = await tx.opportunityProfile.updateMany({ where: { id, workspaceId: ws, revision: expectedRevision }, data: { ...data, revision: { increment: 1 }, ...(archivedAt !== undefined ? { archivedAt: archivedAt ? new Date(archivedAt) : null } : {}) } });
      if (!changed.count) throw new ConflictException("Профиль изменён в другом окне. Обновите данные.");
      return profileDto(await this.owned(tx, ws, id));
    });
  }
  async detail(userId: string, ws: string, id: string) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws); const profile = await this.owned(tx, ws, id);
      const facts = await tx.opportunityFact.findMany({ where: { workspaceId: ws, profileId: id }, orderBy: { createdAt: "asc" } });
      const tracks = await tx.opportunityTrack.findMany({ where: { workspaceId: ws, profileId: id }, orderBy: { createdAt: "asc" } });
      return { ...profileDto(profile), facts: facts.map(factDto), tracks: tracks.map(trackDto), materials: await this.materialPageTx(tx, ws, id) };
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
      const changed = await tx.opportunityFact.updateMany({ where: { id: factId, workspaceId: ws, profileId: id, revision: input.expectedRevision }, data: { state: input.state, revision: { increment: 1 }, confirmedBy: input.state === "confirmed" ? userId : null, confirmedAt: input.state === "confirmed" ? new Date() : null } });
      if (!changed.count) throw new ConflictException("Факт изменён. Обновите данные.");
      return factDto(await tx.opportunityFact.findUniqueOrThrow({ where: { id: factId } }));
    });
  }
  async addTrack(userId: string, ws: string, id: string, input: CreateOpportunityTrackInput) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws, true); await this.owned(tx, ws, id, true);
      if (input.factIds.length && await tx.opportunityFact.count({ where: { id: { in: input.factIds }, profileId: id, workspaceId: ws } }) !== input.factIds.length) throw new NotFoundException("Один из фактов не принадлежит этому профилю");
      return trackDto(await tx.opportunityTrack.create({ data: { workspaceId: ws, profileId: id, name: input.name, factIds: input.factIds, sourceKey: `manual:${randomUUID()}` } }));
    });
  }
  async addMaterial(userId: string, ws: string, id: string, input: CreateOpportunityMaterialInput) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, ws, true); await this.owned(tx, ws, id, true);
      if (input.trackId && !await tx.opportunityTrack.findFirst({ where: { id: input.trackId, profileId: id, workspaceId: ws } })) throw new NotFoundException("Трек не принадлежит этому профилю");
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
  async assertImportTargetTx(tx: Prisma.TransactionClient, userId: string, ws: string, id: string) { await this.guard(tx, userId, ws, true); await this.owned(tx, ws, id, true); }
  async importMaterialTx(tx: Prisma.TransactionClient, userId: string, ws: string, input: ProfileImportMaterial) {
    await this.guard(tx, userId, ws, true);
    const profileCreated = await tx.opportunityProfile.createMany({ skipDuplicates: true, data: [{ id: randomUUID(), workspaceId: ws, displayName: input.candidateName, kind: "person", ownerUserId: userId, sourceKey: input.profileSourceKey, preferences: profilePreferencesSchema.parse({}) }] });
    const profile = await tx.opportunityProfile.findUniqueOrThrow({ where: { workspaceId_sourceKey: { workspaceId: ws, sourceKey: input.profileSourceKey } } });
    if (profile.archivedAt) throw new ConflictException(`Профиль «${profile.displayName}» в архиве. Восстановите его перед импортом.`);
    const trackKey = input.sourceKey;
    await tx.opportunityTrack.createMany({ skipDuplicates: true, data: [{ id: randomUUID(), workspaceId: ws, profileId: profile.id, name: input.title, sourceKey: trackKey, factIds: [] }] });
    const track = await tx.opportunityTrack.findUniqueOrThrow({ where: { workspaceId_profileId_sourceKey: { workspaceId: ws, profileId: profile.id, sourceKey: trackKey } } });
    const materialCreated = await tx.opportunityMaterial.createMany({ skipDuplicates: true, data: [{ id: randomUUID(), workspaceId: ws, profileId: profile.id, trackId: track.id, title: input.title, type: "resume", content: input.content, contentHash: hash(input.content), sourceKey: input.sourceKey, sourcePath: input.sourcePath }] });
    return { profileId: profile.id, profileCreated: profileCreated.count === 1, materialCreated: materialCreated.count === 1 };
  }
}

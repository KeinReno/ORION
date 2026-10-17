import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Opportunity as OpportunityRow, Prisma } from "@prisma/client";
import { opportunitySchema, type CreateOpportunityInput, type Opportunity, type OpportunityListQuery, type OpportunityPage, type UpdateOpportunityInput } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { randomUUID } from "node:crypto";
import type { OpportunitiesImportPort } from "./import-contract";
import type { OpportunitiesReadPort } from "./read-contract";

@Injectable()
export class OpportunitiesService implements OpportunitiesImportPort, OpportunitiesReadPort {
  constructor(private readonly prisma: PrismaService, private readonly modules: ModulesService, private readonly workspaces: WorkspacesService) {}

  async list(userId: string, workspaceId: string, query: OpportunityListQuery): Promise<OpportunityPage> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "opportunities");
      // A foreign or filtered-out cursor is never used to cross a workspace boundary.
      if (query.cursor) await this.owned(tx, workspaceId, query.cursor);
      const rows = await tx.opportunity.findMany({
        where: { workspaceId, ...(query.includeArchived === "true" ? {} : { archivedAt: null }),
          ...(query.kind ? { kind: query.kind } : {}), ...(query.status ? { status: query.status } : {}),
          ...(query.query ? { OR: ["title", "organizationName", "description"].map((field) => ({ [field]: { contains: query.query, mode: "insensitive" } })) } : {}) },
        orderBy: { id: "asc" }, take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
      });
      return { items: rows.slice(0, query.limit).map(dto), nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null };
    });
  }

  async get(userId: string, workspaceId: string, id: string): Promise<Opportunity> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "opportunities");
      return dto(await this.owned(tx, workspaceId, id));
    });
  }

  async create(userId: string, workspaceId: string, input: CreateOpportunityInput): Promise<Opportunity> {
    try {
      return await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "opportunities");
        const history = [{ at: new Date().toISOString(), actorId: userId, action: "created", fromStatus: null, toStatus: input.status }];
        return dto(await tx.opportunity.create({ data: { ...input, workspaceId,
          capturedAt: input.capturedAt ? new Date(input.capturedAt) : null,
          conditions: input.conditions as Prisma.InputJsonValue, history } }));
      });
    } catch (error) { throwKnown(error); throw error; }
  }

  async update(userId: string, workspaceId: string, id: string, input: UpdateOpportunityInput): Promise<Opportunity> {
    try {
      return await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "opportunities");
        const row = await this.owned(tx, workspaceId, id);
        if (row.revision !== input.expectedRevision) throw new ConflictException({ code: "REVISION_CONFLICT", message: "Карточка изменена в другом окне. Обновите данные перед сохранением.", revision: row.revision });
        const { expectedRevision, capturedAt, archivedAt, conditions, ...fields } = input;
        const action = archivedAt === undefined ? "updated" : archivedAt === null ? "restored" : "archived";
        const history = [...dto(row).history, { at: new Date().toISOString(), actorId: userId, action, fromStatus: row.status, toStatus: input.status ?? row.status }];
        const changed = await tx.opportunity.updateMany({ where: { id, workspaceId, revision: expectedRevision }, data: {
          ...fields, revision: { increment: 1 }, history: history as Prisma.InputJsonValue,
          ...(conditions !== undefined ? { conditions: conditions as Prisma.InputJsonValue } : {}),
          ...(capturedAt !== undefined ? { capturedAt: capturedAt ? new Date(capturedAt) : null } : {}),
          ...(archivedAt !== undefined ? { archivedAt: archivedAt ? new Date(archivedAt) : null } : {})
        } });
        if (!changed.count) throw new ConflictException({ code: "REVISION_CONFLICT", message: "Карточка изменена. Обновите данные перед сохранением." });
        return dto(await this.owned(tx, workspaceId, id));
      });
    } catch (error) { throwKnown(error); throw error; }
  }

  async export(userId: string, workspaceId: string): Promise<Opportunity[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "opportunities");
      const rows = await tx.opportunity.findMany({ where: { workspaceId }, orderBy: { id: "asc" }, take: 10_001 });
      if (rows.length > 10_000) throw new BadRequestException("Экспорт больше 10 000 записей. Используйте постраничный API.");
      return rows.map(dto);
    });
  }

  private async owned(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<OpportunityRow> {
    const row = await tx.opportunity.findFirst({ where: { id, workspaceId } });
    if (!row) throw new NotFoundException("Возможность не найдена");
    return row;
  }

  async captureOpportunityTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, input: CreateOpportunityInput) {
    return (await this.captureOpportunitiesTx(tx, userId, workspaceId, [input]))[0];
  }

  async captureOpportunitiesTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, inputs: CreateOpportunityInput[]) {
    await this.workspaces.assertMemberTx(tx, userId, workspaceId);
    await this.modules.assertEnabledTx(tx, userId, workspaceId, "opportunities");
    if (inputs.length > 25 || inputs.some((input) => !input.externalId)) throw new BadRequestException("Нужны внешние ID и не более 25 записей за порцию");
    if (!inputs.length) return [];
    const data = inputs.map((input) => ({ ...input, id: randomUUID(), workspaceId,
      capturedAt: input.capturedAt ? new Date(input.capturedAt) : null, conditions: input.conditions as Prisma.InputJsonValue,
      history: [{ at: new Date().toISOString(), actorId: userId, action: "created", fromStatus: null, toStatus: input.status }] }));
    await tx.opportunity.createMany({ skipDuplicates: true, data });
    const rows = await tx.opportunity.findMany({ where: { workspaceId, OR: inputs.map((input) => ({ sourceType: input.sourceType, externalId: input.externalId })) }, select: { id: true, sourceType: true, externalId: true } });
    const keyed = new Map(rows.map((row) => [JSON.stringify([row.sourceType, row.externalId]), row]));
    return data.map((input) => {
      const row = keyed.get(JSON.stringify([input.sourceType, input.externalId]));
      if (!row) throw new ConflictException("Импортированная запись недоступна");
      return { id: row.id, created: row.id === input.id };
    });
  }
  async readTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, id: string): Promise<Opportunity> {
    await this.workspaces.assertMemberTx(tx, userId, workspaceId);
    await this.modules.assertEnabledTx(tx, userId, workspaceId, "opportunities");
    return dto(await this.owned(tx, workspaceId, id));
  }

  async listCandidatesTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, filter: { sourceType: string; statuses: string[]; limit: number; afterId?: string }): Promise<Opportunity[]> {
    await this.workspaces.assertMemberTx(tx, userId, workspaceId);
    await this.modules.assertEnabledTx(tx, userId, workspaceId, "opportunities");
    const rows = await tx.opportunity.findMany({ where: { workspaceId, archivedAt: null, sourceType: filter.sourceType, status: { in: filter.statuses }, ...(filter.afterId ? { id: { gt: filter.afterId } } : {}) }, orderBy: { id: "asc" }, take: Math.min(Math.max(filter.limit, 1), 200) });
    return rows.map(dto);
  }

  async assertOpportunityTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, id: string) {
    await this.workspaces.assertMemberTx(tx, userId, workspaceId);
    await this.modules.assertEnabledTx(tx, userId, workspaceId, "opportunities");
    await this.owned(tx, workspaceId, id);
  }
  async resolveExternalTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, sourceType: string, externalId: string) {
    await this.workspaces.assertMemberTx(tx, userId, workspaceId);
    await this.modules.assertEnabledTx(tx, userId, workspaceId, "opportunities");
    return (await tx.opportunity.findUnique({ where: { workspaceId_sourceType_externalId: { workspaceId, sourceType, externalId } }, select: { id: true } }))?.id ?? null;
  }
}

function throwKnown(error: unknown): void {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
    throw new ConflictException("Запись с этим источником и внешним ID уже существует");
  }
}
function dto(row: OpportunityRow): Opportunity {
  return opportunitySchema.parse({ id: row.id, workspaceId: row.workspaceId, kind: row.kind, title: row.title,
    organizationName: row.organizationName, description: row.description, sourceType: row.sourceType,
    canonicalUrl: row.canonicalUrl, externalId: row.externalId, status: row.status, conditions: row.conditions,
    capturedAt: row.capturedAt?.toISOString() ?? null, archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), revision: row.revision, history: row.history });
}

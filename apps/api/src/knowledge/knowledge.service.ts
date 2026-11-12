import { readKnowledgeSourceTitle as readNoteTitle } from "../notes/public";
import { readKnowledgeSourceTitle as readDocumentTitle } from "../documents/public";
import { ProjectReferences } from "../projects/public/project-references";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateKnowledgeCategoryInput,
  CreateKnowledgeItemInput,
  CreateKnowledgeRelationInput,
  CreateKnowledgeSourceInput,
  KnowledgeCategory,
  KnowledgeItem,
  KnowledgeItemDetail,
  KnowledgeListQuery,
  KnowledgeRelation,
  KnowledgeSource,
  KnowledgeVerificationState,
  UpdateKnowledgeCategoryInput,
  UpdateKnowledgeItemInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { DomainEventBus } from "../domain-events/domain-event-bus";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { toCategory, toDetail, toItem, toRelation, toSource } from "./knowledge-dto";
import { assertKnowledgeCategoryTx, assertKnowledgeProjectTx } from "./knowledge-refs";
import { pruneKnowledgeRevisionsTx, snapshotKnowledgeRevisionTx } from "./knowledge-revisions";
import { KnowledgeSettingsService } from "./knowledge-settings.service";

const itemInclude = {
  sources: true,
  fromRelations: { include: { to: { select: { id: true, title: true } } } },
  toRelations: { include: { from: { select: { id: true, title: true } } } }
} as const;

const DAY_MS = 86_400_000;

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly projectReferences: ProjectReferences,
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly settings: KnowledgeSettingsService,
    private readonly events: DomainEventBus
  ) {}

  listCategories(userId: string, workspaceId: string): Promise<KnowledgeCategory[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.knowledgeCategory.findMany({
        where: { workspaceId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
      });
      return rows.map(toCategory);
    });
  }

  createCategory(userId: string, workspaceId: string, input: CreateKnowledgeCategoryInput): Promise<KnowledgeCategory> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      if (input.parentId) await this.assertParentCategory(tx, workspaceId, input.parentId);
      const row = await tx.knowledgeCategory.create({
        data: {
          workspaceId,
          name: input.name,
          parentId: input.parentId ?? null,
          sortOrder: input.sortOrder ?? 0
        }
      });
      return toCategory(row);
    });
  }

  updateCategory(
    userId: string,
    workspaceId: string,
    categoryId: string,
    input: UpdateKnowledgeCategoryInput
  ): Promise<KnowledgeCategory> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertCategory(tx, workspaceId, categoryId);
      if (input.parentId) {
        if (input.parentId === categoryId) throw new BadRequestException("Раздел не может быть родителем сам себе");
        await this.assertParentCategory(tx, workspaceId, input.parentId, categoryId);
      }
      const row = await tx.knowledgeCategory.update({
        where: { id: categoryId },
        data: {
          name: input.name,
          parentId: input.parentId,
          sortOrder: input.sortOrder
        }
      });
      return toCategory(row);
    });
  }

  async deleteCategory(userId: string, workspaceId: string, categoryId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertCategory(tx, workspaceId, categoryId);
      const children = await tx.knowledgeCategory.count({ where: { workspaceId, parentId: categoryId } });
      if (children > 0) throw new BadRequestException("Сначала уберите вложенные разделы");
      await tx.knowledgeCategory.delete({ where: { id: categoryId } });
    });
  }

  listItems(userId: string, workspaceId: string, query: KnowledgeListQuery = {}): Promise<KnowledgeItem[]> {
    const includeArchived = query.includeArchived === "true";
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const settings = await this.settings.readTx(tx, workspaceId);
      const now = new Date();
      const cutoff = new Date(now.getTime() - settings.verificationDays * DAY_MS);
      const baseWhere: Prisma.KnowledgeItemWhereInput = {
        workspaceId,
        ...(includeArchived ? {} : { status: { not: "archived" } }),
        ...verificationWhere(query, cutoff)
      };
      const orderBy = sortOrder(query);
      const needle = query.q?.trim();
      const text = needle ? this.textWhere(needle) : {};
      const rows = await tx.knowledgeItem.findMany({ where: { ...baseWhere, ...text }, orderBy });

      // Теги ищутся регистронезависимо (массив строк), поэтому — отдельный запрос по id.
      // Фильтры проверки/архива применяются к найденным id тем же `baseWhere`, чтобы
      // поиск по тегам не показывал то, что скрывает фильтр.
      if (!needle) return rows.map((row) => toItem(row, settings, now));
      const pattern = `%${needle.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      const tagged = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM knowledge_items WHERE "workspaceId" = ${workspaceId} AND EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE tag ILIKE ${pattern} ESCAPE '\\')`
      );
      const seen = new Set(rows.map((row) => row.id));
      const extraIds = tagged.map((row) => row.id).filter((id) => !seen.has(id));
      if (extraIds.length === 0) return rows.map((row) => toItem(row, settings, now));
      const extra = await tx.knowledgeItem.findMany({ where: { ...baseWhere, id: { in: extraIds } }, orderBy });
      return [...rows, ...extra]
        .sort(comparator(query))
        .map((row) => toItem(row, settings, now));
    });
  }

  getItem(userId: string, workspaceId: string, itemId: string): Promise<KnowledgeItemDetail> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const settings = await this.settings.readTx(tx, workspaceId);
      const row = await tx.knowledgeItem.findFirst({ where: { id: itemId, workspaceId }, include: itemInclude });
      if (!row) throw new NotFoundException("Материал не найден");
      return toDetail(row, settings);
    });
  }

  createItem(userId: string, workspaceId: string, input: CreateKnowledgeItemInput): Promise<KnowledgeItemDetail> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await assertKnowledgeCategoryTx(tx, workspaceId, input.categoryId);
      await assertKnowledgeProjectTx(tx, this.projectReferences, workspaceId, input.projectId);
      const settings = await this.settings.readTx(tx, workspaceId);
      const row = await tx.knowledgeItem.create({
        data: {
          workspaceId,
          title: input.title,
          summary: input.summary ?? "",
          body: input.body ?? "",
          categoryId: input.categoryId ?? null,
          projectId: input.projectId ?? null,
          status: input.status ?? "captured",
          visibility: input.visibility ?? "workspace",
          kind: input.kind ?? "fact",
          tags: input.tags ?? [],
          createdBy: userId,
          ...(input.origin ? { origin: input.origin as Prisma.InputJsonValue } : {})
        },
        include: itemInclude
      });
      return toDetail(row, settings);
    });
  }

  updateItem(
    userId: string,
    workspaceId: string,
    itemId: string,
    input: UpdateKnowledgeItemInput
  ): Promise<KnowledgeItemDetail> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const current = await tx.knowledgeItem.findFirst({ where: { id: itemId, workspaceId } });
      if (!current) throw new NotFoundException("Материал не найден");
      if (input.visibility === "private" && current.createdBy !== userId) {
        throw new ForbiddenException("Скрыть материал может только его автор");
      }
      if (input.categoryId) await assertKnowledgeCategoryTx(tx, workspaceId, input.categoryId);
      if (input.projectId !== undefined) await assertKnowledgeProjectTx(tx, this.projectReferences, workspaceId, input.projectId);

      const settings = await this.settings.readTx(tx, workspaceId);
      const now = new Date();
      const expected = input.expectedRevision ?? current.revision;
      const patch = { ...input };
      delete patch.expectedRevision;

      // Правка содержимого снимает подтверждение (п. 6.1). Дата и автор прошлой проверки
      // остаются историческими фактами: состояние — авторитетный признак.
      const contentChanged = itemContentChanged(current, input);
      const resetsVerification = contentChanged && current.verificationState !== "unverified";
      const published = input.status === "published" && current.status !== "published";

      const data = { ...patch, revision: { increment: 1 } } as Prisma.KnowledgeItemUpdateManyMutationInput;
      if (resetsVerification) data.verificationState = "unverified";
      const written = await tx.knowledgeItem.updateMany({ where: { id: itemId, revision: expected }, data });
      if (written.count === 0) {
        const fresh = await tx.knowledgeItem.findFirst({ where: { id: itemId, workspaceId }, include: itemInclude });
        if (!fresh) throw new NotFoundException("Материал не найден");
        throw new ConflictException({
          code: "knowledge_revision_conflict",
          message: "Материал сохранился в другой версии, пока вы его правили",
          currentRevision: fresh.revision,
          current: toDetail(fresh, settings, now)
        });
      }
      const row = await tx.knowledgeItem.findFirstOrThrow({ where: { id: itemId }, include: itemInclude });
      if (resetsVerification) {
        await this.events.publishTx(tx, {
          workspaceId,
          type: "knowledge.item.verification.changed",
          payload: { id: itemId, from: current.verificationState as KnowledgeVerificationState, to: "unverified" },
          actorId: userId
        });
      }
      if (published) {
        await snapshotKnowledgeRevisionTx(tx, row, userId);
        await pruneKnowledgeRevisionsTx(tx, itemId, settings.revisionLimit);
      }
      return toDetail(row, settings, now);
    });
  }

  /** Подтверждение проверки: кто и когда — в самой строке, событие — в той же транзакции. */
  verifyItem(userId: string, workspaceId: string, itemId: string): Promise<KnowledgeItemDetail> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const current = await tx.knowledgeItem.findFirst({ where: { id: itemId, workspaceId }, select: { id: true, verificationState: true } });
      if (!current) throw new NotFoundException("Материал не найден");
      const settings = await this.settings.readTx(tx, workspaceId);
      const now = new Date();
      const row = await tx.knowledgeItem.update({
        where: { id: itemId },
        data: { verificationState: "verified", lastVerifiedAt: now, verifiedById: userId },
        include: itemInclude
      });
      await this.events.publishTx(tx, {
        workspaceId,
        type: "knowledge.item.verification.changed",
        payload: { id: itemId, from: current.verificationState as KnowledgeVerificationState, to: "verified" },
        actorId: userId
      });
      return toDetail(row, settings, now);
    });
  }

  async deleteItem(userId: string, workspaceId: string, itemId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const current = await tx.knowledgeItem.findFirst({ where: { id: itemId, workspaceId } });
      if (!current) throw new NotFoundException("Материал не найден");
      if (current.status === "archived") {
        await tx.knowledgeItem.delete({ where: { id: itemId } });
        return;
      }
      await tx.knowledgeItem.update({ where: { id: itemId }, data: { status: "archived" } });
    });
  }

  addSource(
    userId: string,
    workspaceId: string,
    itemId: string,
    input: CreateKnowledgeSourceInput
  ): Promise<KnowledgeSource> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const item = await tx.knowledgeItem.findFirst({ where: { id: itemId, workspaceId } });
      if (!item) throw new NotFoundException("Материал не найден");
      const type = input.type ?? "manual";
      let sourceTitle = input.sourceTitle ?? "";
      if (type === "note") {
        if (!input.noteId) throw new BadRequestException("Укажите заметку");
        const note = await readNoteTitle(tx, workspaceId, input.noteId);
        if (note === null) throw new BadRequestException("Заметка не найдена в этом пространстве");
        if (!sourceTitle) sourceTitle = note;
      }
      if (type === "document") {
        if (!input.documentId) throw new BadRequestException("Укажите документ");
        const document = await readDocumentTitle(tx, workspaceId, input.documentId);
        if (document === null) throw new BadRequestException("Документ не найден в этом пространстве");
        if (!sourceTitle) sourceTitle = document;
      }
      const row = await tx.knowledgeSource.create({
        data: {
          workspaceId,
          itemId,
          type,
          sourceUrl: input.sourceUrl ?? "",
          sourceTitle,
          sourceAuthor: input.sourceAuthor ?? "",
          originalText: input.originalText ?? "",
          noteId: type === "note" ? input.noteId ?? null : null,
          documentId: type === "document" ? input.documentId ?? null : null
        }
      });
      return toSource(row);
    });
  }

  async deleteSource(userId: string, workspaceId: string, sourceId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await tx.knowledgeSource.findFirst({ where: { id: sourceId, workspaceId } });
      if (!row) throw new NotFoundException("Источник не найден");
      await tx.knowledgeSource.delete({ where: { id: sourceId } });
    });
  }

  addRelation(
    userId: string,
    workspaceId: string,
    itemId: string,
    input: CreateKnowledgeRelationInput
  ): Promise<KnowledgeRelation> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      if (input.toId === itemId) throw new BadRequestException("Материал нельзя связать с самим собой");
      const from = await tx.knowledgeItem.findFirst({ where: { id: itemId, workspaceId } });
      const to = await tx.knowledgeItem.findFirst({ where: { id: input.toId, workspaceId } });
      if (!from || !to) throw new NotFoundException("Материал не найден");
      const row = await tx.knowledgeRelation.create({
        data: { workspaceId, fromId: itemId, toId: input.toId, kind: input.kind ?? "related" }
      });
      return toRelation(row);
    });
  }

  async deleteRelation(userId: string, workspaceId: string, relationId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await tx.knowledgeRelation.findFirst({ where: { id: relationId, workspaceId } });
      if (!row) throw new NotFoundException("Связь не найдена");
      await tx.knowledgeRelation.delete({ where: { id: relationId } });
    });
  }

  /** Условие поиска по title/summary/body/источникам (прежнее поведение списка). */
  private textWhere(needle: string): Prisma.KnowledgeItemWhereInput {
    return {
      OR: [
        { title: { contains: needle, mode: "insensitive" as const } },
        { summary: { contains: needle, mode: "insensitive" as const } },
        { body: { contains: needle, mode: "insensitive" as const } },
        {
          sources: {
            some: {
              OR: [
                { originalText: { contains: needle, mode: "insensitive" as const } },
                { sourceTitle: { contains: needle, mode: "insensitive" as const } },
                { sourceUrl: { contains: needle, mode: "insensitive" as const } }
              ]
            }
          }
        }
      ]
    };
  }

  private async assertCategory(tx: Prisma.TransactionClient, workspaceId: string, categoryId: string): Promise<void> {
    const row = await tx.knowledgeCategory.findFirst({ where: { id: categoryId, workspaceId } });
    if (!row) throw new BadRequestException("Раздел не найден в этом пространстве");
  }

  /** Родитель раздела — только верхний уровень, чтобы дерево не ушло глубже двух. */
  private async assertParentCategory(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    parentId: string,
    categoryId?: string
  ): Promise<void> {
    const parent = await tx.knowledgeCategory.findFirst({ where: { id: parentId, workspaceId } });
    if (!parent) throw new BadRequestException("Раздел не найден в этом пространстве");
    if (parent.parentId) throw new BadRequestException("Вложенный раздел нельзя сделать родителем");
    if (categoryId) {
      const child = await tx.knowledgeCategory.findFirst({ where: { workspaceId, parentId: categoryId } });
      if (child) throw new BadRequestException("У раздела уже есть вложенные — его нельзя вложить");
    }
  }
}

/** Фильтр списка по состоянию проверки; `outdated` — вычисляемое: проверено, но срок вышел. */
function verificationWhere(query: KnowledgeListQuery, cutoff: Date): Prisma.KnowledgeItemWhereInput {
  const state = query.verification;
  const overdue = query.overdue === "true";
  const staleVerified: Prisma.KnowledgeItemWhereInput = {
    verificationState: "verified",
    OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lt: cutoff } }]
  };
  const filters: Prisma.KnowledgeItemWhereInput[] = [];
  if (state === "unverified") filters.push({ verificationState: "unverified" });
  if (state === "outdated") filters.push(staleVerified);
  if (state === "verified") filters.push({ verificationState: "verified", lastVerifiedAt: { gte: cutoff } });
  if (overdue) filters.push({ OR: [{ verificationState: "unverified" }, staleVerified] });
  return filters.length === 0 ? {} : { AND: filters };
}

function sortOrder(query: KnowledgeListQuery): Prisma.KnowledgeItemOrderByWithRelationInput[] {
  if (query.sort === "verification") {
    return [{ lastVerifiedAt: { sort: "asc", nulls: "first" } }, { updatedAt: "desc" }];
  }
  return [{ updatedAt: "desc" }];
}

/** Локальная сортировка склеенной выдачи (основной запрос + теги) тем же правилом, что и в SQL. */
function comparator(query: KnowledgeListQuery) {
  if (query.sort === "verification") {
    return (a: { lastVerifiedAt: Date | null; updatedAt: Date }, b: { lastVerifiedAt: Date | null; updatedAt: Date }): number => {
      const left = a.lastVerifiedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
      const right = b.lastVerifiedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
      return left - right || b.updatedAt.getTime() - a.updatedAt.getTime();
    };
  }
  return (a: { updatedAt: Date }, b: { updatedAt: Date }): number => b.updatedAt.getTime() - a.updatedAt.getTime();
}

/** Значимая правка содержимого: текст/происхождение, а не статус, теги или раздел. */
function itemContentChanged(
  current: { title: string; summary: string; body: string; origin: Prisma.JsonValue | null },
  input: UpdateKnowledgeItemInput
): boolean {
  if (input.title !== undefined && input.title !== current.title) return true;
  if (input.summary !== undefined && input.summary !== current.summary) return true;
  if (input.body !== undefined && input.body !== current.body) return true;
  if (input.origin !== undefined && JSON.stringify(input.origin ?? null) !== JSON.stringify(current.origin ?? null)) return true;
  return false;
}

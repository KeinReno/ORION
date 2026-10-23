import { readKnowledgeSourceTitle as readNoteTitle } from "../notes/public";
import { readKnowledgeSourceTitle as readDocumentTitle } from "../documents/public";
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
  KnowledgeLink,
  KnowledgeRelation,
  KnowledgeSource,
  UpdateKnowledgeCategoryInput,
  UpdateKnowledgeItemInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

const itemInclude = {
  sources: true,
  fromRelations: { include: { to: { select: { id: true, title: true } } } },
  toRelations: { include: { from: { select: { id: true, title: true } } } }
} as const;

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
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

  listItems(userId: string, workspaceId: string, includeArchived: boolean, query?: string): Promise<KnowledgeItem[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const needle = query?.trim();
      const text = needle
        ? {
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
          }
        : {};
      const rows = await tx.knowledgeItem.findMany({
        where: { workspaceId, ...(includeArchived ? {} : { status: { not: "archived" } }), ...text },
        orderBy: { updatedAt: "desc" }
      });
      if (!needle) return rows.map(toItem);
      const pattern = `%${needle.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      const tagged = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM knowledge_items WHERE "workspaceId" = ${workspaceId} AND EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE tag ILIKE ${pattern} ESCAPE '\\')`
      );
      if (tagged.length === 0) return rows.map(toItem);
      const seen = new Set(rows.map((row) => row.id));
      const extra = await tx.knowledgeItem.findMany({
        where: {
          workspaceId,
          id: { in: tagged.map((row) => row.id).filter((id) => !seen.has(id)) },
          ...(includeArchived ? {} : { status: { not: "archived" } })
        }
      });
      return [...rows, ...extra].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map(toItem);
    });
  }

  getItem(userId: string, workspaceId: string, itemId: string): Promise<KnowledgeItemDetail> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await tx.knowledgeItem.findFirst({ where: { id: itemId, workspaceId }, include: itemInclude });
      if (!row) throw new NotFoundException("Материал не найден");
      return toDetail(row);
    });
  }

  createItem(userId: string, workspaceId: string, input: CreateKnowledgeItemInput): Promise<KnowledgeItemDetail> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      if (input.categoryId) await this.assertCategory(tx, workspaceId, input.categoryId);
      const row = await tx.knowledgeItem.create({
        data: {
          workspaceId,
          title: input.title,
          summary: input.summary ?? "",
          body: input.body ?? "",
          categoryId: input.categoryId ?? null,
          status: input.status ?? "captured",
          visibility: input.visibility ?? "workspace",
          kind: input.kind ?? "fact",
          tags: input.tags ?? [],
          createdBy: userId
        },
        include: itemInclude
      });
      return toDetail(row);
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
      if (input.categoryId) await this.assertCategory(tx, workspaceId, input.categoryId);
      const expected = input.expectedRevision ?? current.revision;
      const { expectedRevision: _ignored, ...patch } = input;
      const written = await tx.knowledgeItem.updateMany({
        where: { id: itemId, revision: expected },
        data: { ...patch, revision: { increment: 1 } }
      });
      if (written.count === 0) {
        const fresh = await tx.knowledgeItem.findFirst({ where: { id: itemId, workspaceId }, include: itemInclude });
        if (!fresh) throw new NotFoundException("Материал не найден");
        throw new ConflictException({
          code: "knowledge_revision_conflict",
          message: "Материал сохранился в другой версии, пока вы его правили",
          currentRevision: fresh.revision,
          current: toDetail(fresh)
        });
      }
      const row = await tx.knowledgeItem.findFirstOrThrow({ where: { id: itemId }, include: itemInclude });
      return toDetail(row);
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

type CategoryRow = {
  id: string;
  workspaceId: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type ItemRow = {
  id: string;
  workspaceId: string;
  categoryId: string | null;
  title: string;
  summary: string;
  body: string;
  status: string;
  visibility: string;
  kind: string;
  tags: string[];
  revision: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

type SourceRow = {
  id: string;
  workspaceId: string;
  itemId: string;
  type: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceAuthor: string;
  originalText: string;
  noteId: string | null;
  documentId: string | null;
  capturedAt: Date;
};

type RelationRow = {
  id: string;
  workspaceId: string;
  fromId: string;
  toId: string;
  kind: string;
};

function toCategory(row: CategoryRow): KnowledgeCategory {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toItem(row: ItemRow): KnowledgeItem {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    categoryId: row.categoryId,
    title: row.title,
    summary: row.summary,
    body: row.body,
    status: row.status as KnowledgeItem["status"],
    visibility: row.visibility as KnowledgeItem["visibility"],
    kind: row.kind as KnowledgeItem["kind"],
    tags: row.tags,
    revision: row.revision,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toSource(row: SourceRow): KnowledgeSource {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    itemId: row.itemId,
    type: row.type as KnowledgeSource["type"],
    sourceUrl: row.sourceUrl,
    sourceTitle: row.sourceTitle,
    sourceAuthor: row.sourceAuthor,
    originalText: row.originalText,
    noteId: row.noteId,
    documentId: row.documentId,
    capturedAt: row.capturedAt.toISOString()
  };
}

function toRelation(row: RelationRow): KnowledgeRelation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    fromId: row.fromId,
    toId: row.toId,
    kind: row.kind as KnowledgeRelation["kind"]
  };
}

function toLink(row: RelationRow & { to?: { id: string; title: string }; from?: { id: string; title: string } }, peer: { id: string; title: string }): KnowledgeLink {
  return { ...toRelation(row), peerId: peer.id, peerTitle: peer.title };
}

function toDetail(
  row: ItemRow & {
    sources: SourceRow[];
    fromRelations: Array<RelationRow & { to: { id: string; title: string } }>;
    toRelations: Array<RelationRow & { from: { id: string; title: string } }>;
  }
): KnowledgeItemDetail {
  return {
    ...toItem(row),
    sources: row.sources.map(toSource),
    relations: row.fromRelations.map((link) => toLink(link, link.to)),
    backlinks: row.toRelations.map((link) => toLink(link, link.from))
  };
}

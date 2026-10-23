import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateKnowledgeCategoryInput,
  CreateKnowledgeItemInput,
  CreateKnowledgeRelationInput,
  CreateKnowledgeSourceInput,
  KnowledgeCategory,
  KnowledgeItem,
  KnowledgeItemDetail,
  KnowledgeRelation,
  KnowledgeSource,
  UpdateKnowledgeCategoryInput,
  UpdateKnowledgeItemInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

const itemInclude = { sources: true, fromRelations: true } as const;

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
      if (input.parentId) await this.assertCategory(tx, workspaceId, input.parentId);
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
        await this.assertCategory(tx, workspaceId, input.parentId);
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
      await tx.knowledgeCategory.delete({ where: { id: categoryId } });
    });
  }

  listItems(userId: string, workspaceId: string, includeArchived: boolean): Promise<KnowledgeItem[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.knowledgeItem.findMany({
        where: { workspaceId, ...(includeArchived ? {} : { status: { not: "archived" } }) },
        orderBy: { updatedAt: "desc" }
      });
      return rows.map(toItem);
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
      const row = await tx.knowledgeItem.update({
        where: { id: itemId },
        data: {
          title: input.title,
          summary: input.summary,
          body: input.body,
          categoryId: input.categoryId,
          status: input.status,
          visibility: input.visibility,
          tags: input.tags
        },
        include: itemInclude
      });
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
      const row = await tx.knowledgeSource.create({
        data: {
          workspaceId,
          itemId,
          type: input.type ?? "manual",
          sourceUrl: input.sourceUrl ?? "",
          sourceTitle: input.sourceTitle ?? "",
          sourceAuthor: input.sourceAuthor ?? "",
          originalText: input.originalText ?? ""
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
  tags: string[];
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
    tags: row.tags,
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

function toDetail(row: ItemRow & { sources: SourceRow[]; fromRelations: RelationRow[] }): KnowledgeItemDetail {
  return { ...toItem(row), sources: row.sources.map(toSource), relations: row.fromRelations.map(toRelation) };
}

import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CreateFinanceCategoryInput, FinanceCategory, UpdateFinanceCategoryInput } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  /** `includeArchived` defaults to `false` — see AccountsService.list for the same rule and why. */
  async list(userId: string, workspaceId: string, includeArchived = false): Promise<FinanceCategory[]> {
    const categories = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.financeCategory.findMany({
        where: { workspaceId, ...(includeArchived ? {} : { archivedAt: null }) },
        orderBy: { name: "asc" }
      });
    });
    return categories.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateFinanceCategoryInput): Promise<FinanceCategory> {
    const category = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.financeCategory.create({
        data: { workspaceId, name: input.name, kind: input.kind, color: input.color ?? null }
      });
    });
    return toDto(category);
  }

  async update(
    userId: string,
    workspaceId: string,
    categoryId: string,
    input: UpdateFinanceCategoryInput
  ): Promise<FinanceCategory> {
    const category = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, categoryId);
      return tx.financeCategory.update({ where: { id: categoryId }, data: input });
    });
    return toDto(category);
  }

  async remove(userId: string, workspaceId: string, categoryId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, categoryId);
      await tx.financeCategory.delete({ where: { id: categoryId } });
    });
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, categoryId: string): Promise<void> {
    const category = await tx.financeCategory.findUnique({ where: { id: categoryId } });
    if (!category || category.workspaceId !== workspaceId) {
      throw new NotFoundException("Категория не найдена");
    }
  }
}

type FinanceCategoryRow = {
  id: string;
  workspaceId: string;
  name: string;
  kind: string;
  color: string | null;
  archivedAt: Date | null;
  createdAt: Date;
};

function toDto(category: FinanceCategoryRow): FinanceCategory {
  return {
    id: category.id,
    workspaceId: category.workspaceId,
    name: category.name,
    kind: category.kind as FinanceCategory["kind"],
    color: category.color,
    archivedAt: category.archivedAt ? category.archivedAt.toISOString() : null,
    createdAt: category.createdAt.toISOString()
  };
}

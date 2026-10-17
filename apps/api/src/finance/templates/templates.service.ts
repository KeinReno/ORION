import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CreateFinanceTemplateInput, FinanceTemplate, UpdateFinanceTemplateInput } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { assertAccountInWorkspace, assertCategoryInWorkspace, assertProjectInWorkspace } from "../finance-refs.util";

const MAX_TEMPLATES = 100;

/**
 * Saved starting points for operations. A template never touches a balance: using one is an ordinary
 * `POST transactions` from the client. References are checked against THIS workspace when saved; later deletion
 * of an account leaves the id dangling by design (the template still opens, the user picks another account).
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string): Promise<FinanceTemplate[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.financeTemplate.findMany({ where: { workspaceId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    });
    return rows.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateFinanceTemplateInput): Promise<FinanceTemplate> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertRefs(tx, workspaceId, input);
      const count = await tx.financeTemplate.count({ where: { workspaceId } });
      if (count >= MAX_TEMPLATES) throw new BadRequestException(`Не больше ${MAX_TEMPLATES} шаблонов`);
      const last = await tx.financeTemplate.aggregate({ where: { workspaceId }, _max: { sortOrder: true } });
      return tx.financeTemplate.create({
        data: {
          workspaceId,
          name: input.name,
          type: input.type,
          accountId: input.accountId ?? null,
          toAccountId: input.type === "transfer" ? (input.toAccountId ?? null) : null,
          categoryId: input.type === "transfer" ? null : (input.categoryId ?? null),
          projectId: input.projectId ?? null,
          amount: input.amount ?? null,
          note: input.note,
          tags: input.tags,
          sortOrder: (last._max.sortOrder ?? 0) + 10
        }
      });
    });
    return toDto(row);
  }

  async update(userId: string, workspaceId: string, templateId: string, input: UpdateFinanceTemplateInput): Promise<FinanceTemplate> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, templateId);
      await this.assertRefs(tx, workspaceId, input);
      return tx.financeTemplate.update({ where: { id: templateId }, data: input });
    });
    return toDto(row);
  }

  async remove(userId: string, workspaceId: string, templateId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, templateId);
      await tx.financeTemplate.delete({ where: { id: templateId } });
    });
  }

  private async assertRefs(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    input: { accountId?: string | null; toAccountId?: string | null; categoryId?: string | null; projectId?: string | null }
  ): Promise<void> {
    if (input.accountId) await assertAccountInWorkspace(tx, workspaceId, input.accountId);
    if (input.toAccountId) await assertAccountInWorkspace(tx, workspaceId, input.toAccountId);
    if (input.categoryId) await assertCategoryInWorkspace(tx, workspaceId, input.categoryId);
    if (input.projectId) await assertProjectInWorkspace(tx, workspaceId, input.projectId);
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, templateId: string): Promise<void> {
    const row = await tx.financeTemplate.findUnique({ where: { id: templateId } });
    if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Шаблон не найден");
  }
}

type TemplateRow = {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  accountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  projectId: string | null;
  amount: number | null;
  note: string;
  tags: string[];
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(row: TemplateRow): FinanceTemplate {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    type: row.type as FinanceTemplate["type"],
    accountId: row.accountId,
    toAccountId: row.toAccountId,
    categoryId: row.categoryId,
    projectId: row.projectId,
    amount: row.amount,
    note: row.note,
    tags: row.tags,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CreateRecurringTransactionInput, RecurringTransaction, UpdateRecurringTransactionInput } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { assertAccountInWorkspace, assertCategoryInWorkspace } from "../finance-refs.util";

@Injectable()
export class RecurringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string): Promise<RecurringTransaction[]> {
    const rules = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.recurringTransaction.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
    });
    return rules.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateRecurringTransactionInput): Promise<RecurringTransaction> {
    const rule = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await assertAccountInWorkspace(tx, workspaceId, input.accountId);
      if (input.categoryId) await assertCategoryInWorkspace(tx, workspaceId, input.categoryId);
      return tx.recurringTransaction.create({
        data: {
          workspaceId,
          accountId: input.accountId,
          categoryId: input.categoryId ?? null,
          type: input.type,
          amount: input.amount,
          note: input.note,
          interval: input.interval,
          anchorDay: input.anchorDay,
          nextRunAt: input.nextRunAt
        }
      });
    });
    return toDto(rule);
  }

  async update(
    userId: string,
    workspaceId: string,
    recurringId: string,
    input: UpdateRecurringTransactionInput
  ): Promise<RecurringTransaction> {
    const rule = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, recurringId);
      if (input.accountId) await assertAccountInWorkspace(tx, workspaceId, input.accountId);
      if (input.categoryId) await assertCategoryInWorkspace(tx, workspaceId, input.categoryId);
      return tx.recurringTransaction.update({ where: { id: recurringId }, data: input });
    });
    return toDto(rule);
  }

  async remove(userId: string, workspaceId: string, recurringId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, recurringId);
      await tx.recurringTransaction.delete({ where: { id: recurringId } });
    });
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, recurringId: string): Promise<void> {
    const rule = await tx.recurringTransaction.findUnique({ where: { id: recurringId } });
    if (!rule || rule.workspaceId !== workspaceId) {
      throw new NotFoundException("Повторяющаяся операция не найдена");
    }
  }
}

type RecurringRow = {
  id: string;
  workspaceId: string;
  accountId: string;
  categoryId: string | null;
  type: string;
  amount: number;
  note: string;
  interval: string;
  anchorDay: number;
  nextRunAt: Date;
  pausedAt: Date | null;
  createdAt: Date;
};

function toDto(rule: RecurringRow): RecurringTransaction {
  return {
    id: rule.id,
    workspaceId: rule.workspaceId,
    accountId: rule.accountId,
    categoryId: rule.categoryId,
    type: rule.type as RecurringTransaction["type"],
    amount: rule.amount,
    note: rule.note,
    interval: rule.interval as RecurringTransaction["interval"],
    anchorDay: rule.anchorDay,
    nextRunAt: rule.nextRunAt.toISOString(),
    pausedAt: rule.pausedAt ? rule.pausedAt.toISOString() : null,
    createdAt: rule.createdAt.toISOString()
  };
}

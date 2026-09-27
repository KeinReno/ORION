import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CreateTransactionInput, Transaction, UpdateTransactionInput } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { BudgetAlertsService } from "../budget-alerts.service";
import {
  assertAccountInWorkspace,
  assertCategoryInWorkspace,
  assertProjectInWorkspace,
  assertTransactionShape,
  explicitRange,
  monthRange
} from "../finance-refs.util";

const DEFAULT_PAGE_SIZE = 50;

export interface TransactionFilters {
  accountId?: string;
  categoryId?: string;
  tag?: string;
  /** "YYYY-MM" — matches occurredAt within that calendar month. Ignored if `from`/`to` is given. */
  month?: string;
  /** ISO datetimes — an arbitrary range, takes priority over `month` when either is set. */
  from?: string;
  to?: string;
  /** Default 50. The list has no separate "total count" — the caller pages by checking `items.length === limit`. */
  limit?: number;
  offset?: number;
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly budgetAlerts: BudgetAlertsService
  ) {}

  async list(userId: string, workspaceId: string, filters: TransactionFilters = {}): Promise<Transaction[]> {
    const transactions = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const where: Prisma.TransactionWhereInput = { workspaceId };
      if (filters.accountId) where.accountId = filters.accountId;
      if (filters.categoryId) where.lines = { some: { categoryId: filters.categoryId } };
      if (filters.tag) where.tags = { has: filters.tag };
      // An explicit from/to range wins over `month` — see TransactionFilters.
      const range = explicitRange(filters.from, filters.to) ?? monthRange(filters.month);
      if (range) {
        where.occurredAt = {
          ...(range.start ? { gte: range.start } : {}),
          ...(range.end ? { lt: range.end } : {})
        };
      }
      return tx.transaction.findMany({
        where,
        include: { lines: true },
        orderBy: { occurredAt: "desc" },
        take: filters.limit ?? DEFAULT_PAGE_SIZE,
        skip: filters.offset ?? 0
      });
    });
    return transactions.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateTransactionInput): Promise<Transaction> {
    assertTransactionShape(input);
    const { transaction, alerts } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await assertAccountInWorkspace(tx, workspaceId, input.accountId);
      if (input.toAccountId) await assertAccountInWorkspace(tx, workspaceId, input.toAccountId);
      if (input.projectId) await assertProjectInWorkspace(tx, workspaceId, input.projectId);
      for (const line of input.lines) {
        if (line.categoryId) await assertCategoryInWorkspace(tx, workspaceId, line.categoryId);
      }
      const created = await tx.transaction.create({
        data: {
          workspaceId,
          accountId: input.accountId,
          toAccountId: input.toAccountId ?? null,
          type: input.type,
          note: input.note,
          tags: input.tags ?? [],
          // The contract has accepted `projectId` since v0.14 and the column
          // exists, but the service dropped it on the floor — a set project
          // never survived the write.
          projectId: input.projectId ?? null,
          occurredAt: input.occurredAt,
          lines: {
            create: input.lines.map((line) => ({ workspaceId, categoryId: line.categoryId ?? null, amount: line.amount }))
          }
        },
        include: { lines: true }
      });
      // Budget check inside the same transaction; the Telegram text goes out
      // only after the commit (see BudgetAlertsService).
      const alerts = await this.budgetAlerts.evaluate(
        tx,
        workspaceId,
        created.lines.map((line) => line.categoryId),
        created.occurredAt
      );
      return { transaction: created, alerts };
    });
    await this.budgetAlerts.deliver(alerts);
    return toDto(transaction);
  }

  async update(
    userId: string,
    workspaceId: string,
    transactionId: string,
    input: UpdateTransactionInput
  ): Promise<Transaction> {
    const { transaction, alerts } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const current = await this.assertOwnedTx(tx, workspaceId, transactionId);

      // Validate the *merged* picture — a PATCH touching only `note` must not
      // have to resend accountId/lines just to pass the transfer/split check.
      assertTransactionShape({
        accountId: input.accountId ?? current.accountId,
        toAccountId: input.toAccountId !== undefined ? input.toAccountId : current.toAccountId,
        type: input.type ?? (current.type as CreateTransactionInput["type"]),
        lines: input.lines ?? current.lines
      });

      if (input.accountId) await assertAccountInWorkspace(tx, workspaceId, input.accountId);
      if (input.toAccountId) await assertAccountInWorkspace(tx, workspaceId, input.toAccountId);
      if (input.projectId) await assertProjectInWorkspace(tx, workspaceId, input.projectId);
      if (input.lines) {
        for (const line of input.lines) {
          if (line.categoryId) await assertCategoryInWorkspace(tx, workspaceId, line.categoryId);
        }
      }

      if (input.lines) {
        // Full replace, same idiom as Note.tags — simpler and safer than
        // diffing which lines changed for what's at most a handful of rows.
        await tx.transactionLine.deleteMany({ where: { transactionId } });
      }

      const updated = await tx.transaction.update({
        where: { id: transactionId },
        data: {
          accountId: input.accountId,
          toAccountId: input.toAccountId,
          type: input.type,
          note: input.note,
          tags: input.tags,
          projectId: input.projectId,
          occurredAt: input.occurredAt,
          lines: input.lines
            ? { create: input.lines.map((line) => ({ workspaceId, categoryId: line.categoryId ?? null, amount: line.amount })) }
            : undefined
        },
        include: { lines: true }
      });
      // Re-checked after every edit (not only when lines change): moving an
      // operation into another month can push that month's budget over. The
      // dedup key is per (budget, month), so an alert is never repeated.
      const alerts = await this.budgetAlerts.evaluate(
        tx,
        workspaceId,
        updated.lines.map((line) => line.categoryId),
        updated.occurredAt
      );
      return { transaction: updated, alerts };
    });
    await this.budgetAlerts.deliver(alerts);
    return toDto(transaction);
  }

  async remove(userId: string, workspaceId: string, transactionId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, transactionId);
      // Lines cascade (onDelete: Cascade in schema.prisma).
      await tx.transaction.delete({ where: { id: transactionId } });
    });
  }

  private async assertOwnedTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    transactionId: string
  ): Promise<TransactionRow> {
    const transaction = await tx.transaction.findUnique({ where: { id: transactionId }, include: { lines: true } });
    if (!transaction || transaction.workspaceId !== workspaceId) {
      throw new NotFoundException("Операция не найдена");
    }
    return transaction;
  }
}

type TransactionRow = {
  id: string;
  workspaceId: string;
  accountId: string;
  toAccountId: string | null;
  type: string;
  note: string;
  tags: string[];
  projectId: string | null;
  reconciledAt: Date | null;
  importedRef: string | null;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
  lines: { id: string; categoryId: string | null; amount: number }[];
};

function toDto(transaction: TransactionRow): Transaction {
  return {
    id: transaction.id,
    workspaceId: transaction.workspaceId,
    accountId: transaction.accountId,
    toAccountId: transaction.toAccountId,
    type: transaction.type as Transaction["type"],
    note: transaction.note,
    tags: transaction.tags,
    projectId: transaction.projectId,
    reconciledAt: transaction.reconciledAt ? transaction.reconciledAt.toISOString() : null,
    importedRef: transaction.importedRef,
    occurredAt: transaction.occurredAt.toISOString(),
    lines: transaction.lines.map((line) => ({ id: line.id, categoryId: line.categoryId, amount: line.amount })),
    totalAmount: transaction.lines.reduce((sum, line) => sum + line.amount, 0),
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString()
  };
}

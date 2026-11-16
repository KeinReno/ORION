import { ProjectReferences } from "../../projects/public/project-references";
import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  CreateTransactionInput,
  FinanceImportInput,
  FinanceImportResult,
  Transaction,
  TransactionType,
  UpdateTransactionInput
} from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { BudgetAlertsService } from "../budget-alerts.service";
import { FinanceSettingsService } from "../finance-settings.service";
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
  /** Operations booked to one project (the "what did this project cost" slice). */
  projectId?: string;
  /** Operations whose (source) account has this context. */
  context?: string;
  tag?: string;
  /** Case-insensitive substring of the note. */
  q?: string;
  /** Kopecks; matches an operation that has a line within the range (for a plain operation, its amount). */
  minAmount?: number;
  maxAmount?: number;
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
    private readonly projectReferences: ProjectReferences,
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly budgetAlerts: BudgetAlertsService,
    private readonly financeSettings: FinanceSettingsService
  ) {}

  async list(userId: string, workspaceId: string, filters: TransactionFilters = {}): Promise<Transaction[]> {
    const transactions = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const where: Prisma.TransactionWhereInput = { workspaceId };
      if (filters.accountId) where.accountId = filters.accountId;
      const lineFilters: Prisma.TransactionLineWhereInput[] = [];
      if (filters.categoryId) lineFilters.push({ categoryId: filters.categoryId });
      if (Number.isFinite(filters.minAmount)) lineFilters.push({ amount: { gte: filters.minAmount } });
      if (Number.isFinite(filters.maxAmount)) lineFilters.push({ amount: { lte: filters.maxAmount } });
      // One `some` with every condition: «a category AND an amount» must hold for the same line.
      if (lineFilters.length > 0) where.lines = { some: { AND: lineFilters } };
      const text = filters.q?.trim();
      if (text) where.note = { contains: text, mode: "insensitive" };
      if (filters.projectId) where.projectId = filters.projectId;
      if (filters.context) where.account = { context: filters.context };
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

  async get(userId: string, workspaceId: string, transactionId: string): Promise<Transaction> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return toDto(await this.assertOwnedTx(tx, workspaceId, transactionId));
    });
  }

  async create(userId: string, workspaceId: string, input: CreateTransactionInput): Promise<Transaction> {
    assertTransactionShape(input);
    const { transaction, alerts } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const accountId = await this.resolveAccountTx(tx, workspaceId, input.type, input.accountId);
      if (input.toAccountId) await assertAccountInWorkspace(tx, workspaceId, input.toAccountId);
      if (input.projectId) await assertProjectInWorkspace(tx, workspaceId, input.projectId, this.projectReferences);
      for (const line of input.lines) {
        if (line.categoryId) await assertCategoryInWorkspace(tx, workspaceId, line.categoryId);
      }
      const created = await tx.transaction.create({
        data: {
          workspaceId,
          accountId,
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

  /**
   * Batch import into one account (see `financeImportInputSchema`). Everything is checked inside ONE
   * transaction: the account and every referenced category must belong to this workspace, a category's
   * kind must match the row's type, a `ref` already in the workspace (or repeated in the payload) is a
   * duplicate, not an error. Rows are written with two bulk statements (headers, then lines) so a few
   * thousand rows stay well inside the transaction timeout. No budget alerts are sent for imported history.
   */
  async importRows(userId: string, workspaceId: string, input: FinanceImportInput): Promise<FinanceImportResult> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await assertAccountInWorkspace(tx, workspaceId, input.accountId);

      const categoryIds = [...new Set(input.rows.map((row) => row.categoryId).filter((id): id is string => Boolean(id)))];
      const categories = categoryIds.length
        ? await tx.financeCategory.findMany({ where: { id: { in: categoryIds }, workspaceId }, select: { id: true, kind: true } })
        : [];
      const kindById = new Map(categories.map((category) => [category.id, category.kind as string]));

      const refs = input.rows.map((row) => row.ref);
      // A reference is known if a row carries it — or a transfer absorbed the row that did («Сопоставление переводов»).
      const existing = await tx.transaction.findMany({
        where: { workspaceId, OR: [{ importedRef: { in: refs } }, { mergedRefs: { hasSome: refs } }] },
        select: { importedRef: true, mergedRefs: true }
      });
      const known = new Set<string | null>(existing.flatMap((row) => [row.importedRef, ...row.mergedRefs]));

      const errors: FinanceImportResult["errors"] = [];
      const accepted: FinanceImportInput["rows"] = [];
      let duplicates = 0;
      input.rows.forEach((row, index) => {
        const line = index + 1;
        if (known.has(row.ref)) {
          duplicates += 1;
          return;
        }
        if (row.categoryId) {
          const kind = kindById.get(row.categoryId);
          if (kind === undefined) {
            errors.push({ line, reason: "Категория не найдена в этом рабочем пространстве" });
            return;
          }
          if (kind !== row.type) {
            errors.push({ line, reason: "Категория не подходит к типу операции (доход/расход)" });
            return;
          }
        }
        known.add(row.ref);
        accepted.push(row);
      });

      const incomeTotal = accepted.filter((row) => row.type === "income").reduce((sum, row) => sum + row.amount, 0);
      const expenseTotal = accepted.filter((row) => row.type === "expense").reduce((sum, row) => sum + row.amount, 0);

      if (!input.dryRun && accepted.length > 0) {
        const ids = accepted.map(() => randomUUID());
        await tx.transaction.createMany({
          data: accepted.map((row, index) => ({
            id: ids[index]!,
            workspaceId,
            accountId: input.accountId,
            toAccountId: null,
            type: row.type,
            note: row.note,
            tags: row.tags,
            projectId: null,
            importedRef: row.ref,
            occurredAt: row.occurredAt
          }))
        });
        await tx.transactionLine.createMany({
          data: accepted.map((row, index) => ({
            workspaceId,
            transactionId: ids[index]!,
            categoryId: row.categoryId ?? null,
            amount: row.amount
          }))
        });
      }
      return { dryRun: input.dryRun, imported: accepted.length, duplicates, errors, incomeTotal, expenseTotal };
    });
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
      const mergedType = input.type ?? (current.type as CreateTransactionInput["type"]);
      assertTransactionShape({
        accountId: input.accountId ?? current.accountId,
        toAccountId: input.toAccountId !== undefined ? input.toAccountId : current.toAccountId,
        type: mergedType,
        lines: input.lines ?? current.lines
      });
      // Transfers are advanced-only; a PATCH morphing an operation into one in
      // simple mode is rejected here, the same as creating one.
      await this.assertNoTransferInSimpleModeTx(tx, workspaceId, mergedType);

      if (input.accountId) await assertAccountInWorkspace(tx, workspaceId, input.accountId);
      if (input.toAccountId) await assertAccountInWorkspace(tx, workspaceId, input.toAccountId);
      if (input.projectId) await assertProjectInWorkspace(tx, workspaceId, input.projectId, this.projectReferences);
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

  /**
   * The account an operation books to. Advanced mode is unchanged — `accountId`
   * is required. In simple mode it may be omitted and the operation lands on
   * the auto-created default account ("Основной"); an explicit accountId is
   * still honoured (asserted against the workspace) so data written before
   * switching modes keeps working.
   */
  private async resolveAccountTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    type: TransactionType,
    accountId: string | undefined
  ): Promise<string> {
    await this.assertNoTransferInSimpleModeTx(tx, workspaceId, type);
    if (accountId) {
      await assertAccountInWorkspace(tx, workspaceId, accountId);
      return accountId;
    }
    const mode = await this.financeSettings.readModeTx(tx, workspaceId);
    if (mode !== "simple") throw new BadRequestException("Укажите счёт операции");
    return this.financeSettings.resolveDefaultAccountTx(tx, workspaceId);
  }

  /** Transfers stay advanced-only: moving money between accounts is meaningless without the accounts surface. */
  private async assertNoTransferInSimpleModeTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    type: TransactionType
  ): Promise<void> {
    if (type !== "transfer") return;
    const mode = await this.financeSettings.readModeTx(tx, workspaceId);
    if (mode === "simple") {
      throw new BadRequestException("Переводы доступны только в расширенном режиме финансов");
    }
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

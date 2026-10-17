import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { primaryAccountCurrency } from "@orion/shared-types";

/**
 * Three of the five finance services reference an Account and/or a
 * FinanceCategory by id (Transaction, Budget, RecurringTransaction) —
 * shared here instead of tripled, unlike the single-entity assertOwnedTx
 * pattern in notes/tasks. Guards against an id that's real but belongs to a
 * *different* workspace this same user also happens to be a member of
 * (RLS wouldn't catch that on its own — both rows are visible to the user,
 * just not meant to be mixed).
 */
export async function assertAccountInWorkspace(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  accountId: string
): Promise<void> {
  const account = await tx.account.findUnique({ where: { id: accountId } });
  if (!account || account.workspaceId !== workspaceId) {
    throw new BadRequestException("Счёт не найден в этом рабочем пространстве");
  }
}

export async function assertCategoryInWorkspace(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  categoryId: string
): Promise<void> {
  const category = await tx.financeCategory.findUnique({ where: { id: categoryId } });
  if (!category || category.workspaceId !== workspaceId) {
    throw new BadRequestException("Категория не найдена в этом рабочем пространстве");
  }
}

/**
 * The same check for a project link (v0.14 added `Transaction.projectId`).
 * Mirrors `assertProjectTx` in notes/events/inbox: the id must resolve to a
 * project *of this workspace*, otherwise a user who is a member of two
 * workspaces could file a transaction into the other one's project.
 */
export async function assertProjectInWorkspace(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string
): Promise<void> {
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project || project.workspaceId !== workspaceId) {
    throw new BadRequestException("Проект не найден в этом рабочем пространстве");
  }
}

/** Parses "YYYY-MM" into a [start, end) UTC range covering that calendar month — used by both TransactionsService (filter) and BudgetsService (spent aggregation). */
export function monthRange(month: string | undefined): { start: Date; end: Date } | null {
  if (!month) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return { start: new Date(Date.UTC(year, monthIndex, 1)), end: new Date(Date.UTC(year, monthIndex + 1, 1)) };
}

/** Inverse of the "YYYY-MM" parsing above — needed when we only have a stored first-of-month Date and want its range again. */
export function toMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** First day of the month `date` falls in, at UTC midnight — the shape `Budget.month` is stored in. */
export function firstOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Sum of expense-line amounts for a category within one calendar month, in
 * one currency.
 * Filters on the *line's* categoryId (v0.9 — a split transaction can put only
 * part of its total against this category) via a Prisma relation filter on the
 * parent transaction, rather than a raw join.
 *
 * Shared since v0.16 by BudgetsService (the `spent` it returns) and
 * BudgetAlertsService (the overrun check after a new expense) — two copies of
 * this rule would eventually disagree about what "spent" means.
 *
 * Only the budget's own currency counts: a USD expense is not "spent" out of a
 * RUB limit (an expense's currency is its source account's).
 */
export async function budgetSpentTx(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  categoryId: string,
  month: Date,
  currency: string
): Promise<number> {
  const range = monthRange(toMonthKey(month)) as { start: Date; end: Date };
  const sum = await tx.transactionLine.aggregate({
    where: {
      categoryId,
      transaction: { workspaceId, type: "expense", occurredAt: { gte: range.start, lt: range.end }, account: { currency } }
    },
    _sum: { amount: true }
  });
  return sum._sum.amount ?? 0;
}

const MAX_ROLLOVER_MONTHS = 12;

/**
 * What a budget inherits from earlier months. Only a budget with `rollover` inherits, and only from the budget of the
 * SAME category and SAME currency in the month right before it (a month without such a budget breaks the chain —
 * nothing is guessed, and a USD leftover never tops up a RUB limit). Only
 * a positive leftover is carried; an overspend is not charged to the next month. Capped at a year of chain.
 */
export async function budgetCarryOverTx(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  budget: { categoryId: string; month: Date; currency: string; rollover: boolean },
  depth = 0
): Promise<number> {
  if (!budget.rollover || depth >= MAX_ROLLOVER_MONTHS) return 0;
  const previousMonth = new Date(Date.UTC(budget.month.getUTCFullYear(), budget.month.getUTCMonth() - 1, 1));
  const previous = await tx.budget.findUnique({
    where: { categoryId_month_currency: { categoryId: budget.categoryId, month: previousMonth, currency: budget.currency } }
  });
  if (!previous || previous.workspaceId !== workspaceId) return 0;
  const [carry, spent] = await Promise.all([
    budgetCarryOverTx(tx, workspaceId, previous, depth + 1),
    budgetSpentTx(tx, workspaceId, previous.categoryId, previous.month, previous.currency)
  ]);
  return Math.max(0, previous.limitAmount + carry - spent);
}

/**
 * The workspace's primary currency (`primaryAccountCurrency`: the one most of its live accounts are in) — what a
 * budget created without an explicit currency is denominated in. RLS applies: a member sees only the accounts
 * visible to them, which is also the set their figures are built from.
 */
export async function primaryCurrencyTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<string> {
  const accounts = await tx.account.findMany({ where: { workspaceId }, select: { currency: true, archivedAt: true } });
  return primaryAccountCurrency(accounts);
}

/**
 * An arbitrary `[from, to)` range from two ISO datetimes — the v0.13
 * alternative to `monthRange` for callers that want "this quarter" or
 * "last 45 days" rather than a calendar month. Returns `null` unless at
 * least one bound is given; a missing bound is open-ended.
 */
export function explicitRange(from: string | undefined, to: string | undefined): { start?: Date; end?: Date } | null {
  if (!from && !to) return null;
  return { start: from ? new Date(from) : undefined, end: to ? new Date(to) : undefined };
}

interface NetRow {
  account_id: string;
  to_account_id: string | null;
  type: string;
  total: number;
}

/**
 * One raw join covers every account in the workspace — income adds to its
 * account, expense subtracts, and a transfer moves the amount from
 * `accountId` to `toAccountId` (never counted as income/expense anywhere).
 * Runs inside the same `withUser` transaction as the caller, so RLS applies
 * identically to this raw query too. Shared by AccountsService (balance)
 * and GoalsService (a goal's progress is just its account's balance) —
 * moved here in v0.13 so the second caller isn't a copy of the first.
 */
export async function computeNetByAccount(tx: Prisma.TransactionClient, workspaceId: string): Promise<Map<string, number>> {
  const rows = await tx.$queryRaw<NetRow[]>`
    SELECT t."accountId" AS account_id, t."toAccountId" AS to_account_id, t."type" AS type, SUM(l."amount")::int AS total
    FROM "finance_transactions" t
    JOIN "finance_transaction_lines" l ON l."transactionId" = t.id
    WHERE t."workspaceId" = ${workspaceId}
    GROUP BY t."accountId", t."toAccountId", t."type"
  `;
  const net = new Map<string, number>();
  const add = (accountId: string, delta: number): void => {
    net.set(accountId, (net.get(accountId) ?? 0) + delta);
  };
  for (const row of rows) {
    if (row.type === "income") add(row.account_id, row.total);
    else if (row.type === "expense") add(row.account_id, -row.total);
    else if (row.type === "transfer" && row.to_account_id) {
      add(row.account_id, -row.total);
      add(row.to_account_id, row.total);
    }
  }
  return net;
}

export interface TransactionShape {
  accountId: string;
  toAccountId?: string | null;
  type: "income" | "expense" | "transfer";
  lines: { categoryId?: string | null; amount: number }[];
}

/**
 * The one place that knows what a valid transaction looks like — used by
 * both `create` (against the raw input) and `update` (against the input
 * merged with the record already in the database, since a PATCH may only
 * touch one field). Not a zod `.superRefine` on the shared-types schema:
 * that would only ever see the partial PATCH body, never the merged
 * picture, so it can't actually validate an update correctly. See
 * docs/HISTORY.md v0.9.
 */
export function assertTransactionShape(shape: TransactionShape): void {
  if (shape.type === "transfer") {
    if (!shape.toAccountId) {
      throw new BadRequestException("У перевода нужно указать счёт назначения");
    }
    if (shape.toAccountId === shape.accountId) {
      throw new BadRequestException("Счета перевода должны различаться");
    }
    if (shape.lines.length !== 1) {
      throw new BadRequestException("У перевода ровно одна сумма");
    }
    if (shape.lines[0].categoryId) {
      throw new BadRequestException("У перевода нет категории");
    }
    return;
  }
  if (shape.toAccountId) {
    throw new BadRequestException("Счёт назначения указывается только для переводов");
  }
}

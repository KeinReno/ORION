import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { DEFAULT_FINANCE_CURRENCY, type CategoryBreakdownEntry, type MonthlyFinanceSummary } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { explicitRange, monthRange, toMonthKey } from "../finance-refs.util";

const MAX_MONTHS = 24;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  /**
   * Oldest-first, `months` entries ending with the current month — the
   * natural left-to-right order for a chart. `netWorth` is a running
   * cumulative total (starting balances + income so far − expense so far),
   * not re-aggregated from scratch per month: a transfer never appears in
   * it at all (see `transactionTypeSchema`'s doc comment) — money moving
   * between the user's own accounts nets to zero across the total, so only
   * income/expense ever need summing here.
   *
   * One series per account currency (alphabetical), each `months` long —
   * kopecks of RUB and cents of USD are never added together (see
   * monthlyFinanceSummarySchema). Archived accounts count: their history is
   * still part of the past months. A transfer between two accounts of the
   * same currency still nets to zero; a transfer between currencies moves
   * money from one series to the other, so `netWorth` of the last month
   * matches the sum of that currency's account balances (balances move the
   * transfer amount as is, without conversion — see computeNetByAccount).
   * Transfers never show up in `income`/`expense`.
   */
  async monthlySummary(userId: string, workspaceId: string, months: number): Promise<MonthlyFinanceSummary[]> {
    const count = Math.min(Math.max(1, months), MAX_MONTHS);
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);

      const startingByCurrency = await tx.account.groupBy({
        by: ["currency"],
        where: { workspaceId },
        _sum: { startingBalance: true },
        orderBy: { currency: "asc" }
      });
      const currencies = startingByCurrency.length
        ? startingByCurrency.map((row) => ({ currency: row.currency, starting: row._sum.startingBalance ?? 0 }))
        : [{ currency: DEFAULT_FINANCE_CURRENCY, starting: 0 }];

      const keys = lastMonthKeys(count);
      const results: MonthlyFinanceSummary[] = [];
      for (const { currency, starting } of currencies) {
        let netWorth = starting;
        for (const key of keys) {
          const range = monthRange(key) as { start: Date; end: Date };
          const [income, expense] = await Promise.all([
            sumLines(tx, workspaceId, "income", range, currency),
            sumLines(tx, workspaceId, "expense", range, currency)
          ]);
          const [transferIn, transferOut] = await Promise.all([
            sumCrossCurrencyTransfers(tx, workspaceId, range, currency, "in"),
            sumCrossCurrencyTransfers(tx, workspaceId, range, currency, "out")
          ]);
          netWorth += income - expense + transferIn - transferOut;
          results.push({ month: key, currency, income, expense, netWorth });
        }
      }
      return results;
    });
  }

  /**
   * Expense-only breakdown by category for one period — `categoryId: null`
   * groups uncategorised lines under "Без категории". `from`/`to` (v0.13)
   * take priority over `month` when either is given, same rule as
   * `TransactionsService.list`. One entry per (category, currency), currency
   * by currency (alphabetical), largest first within each: Prisma's groupBy
   * can't group by a relation field, so it runs once per account currency —
   * a workspace has a handful of those at most.
   */
  async categoryBreakdown(
    userId: string,
    workspaceId: string,
    opts: { month?: string; from?: string; to?: string }
  ): Promise<CategoryBreakdownEntry[]> {
    const range = explicitRange(opts.from, opts.to) ?? monthRange(opts.month);
    if (!range) return [];
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const currencyRows = await tx.account.findMany({
        where: { workspaceId },
        distinct: ["currency"],
        select: { currency: true },
        orderBy: { currency: "asc" }
      });
      const grouped: { categoryId: string | null; currency: string; amount: number }[] = [];
      for (const { currency } of currencyRows) {
        const rows = await tx.transactionLine.groupBy({
          by: ["categoryId"],
          where: {
            workspaceId,
            transaction: {
              type: "expense",
              account: { currency },
              occurredAt: { ...(range.start ? { gte: range.start } : {}), ...(range.end ? { lt: range.end } : {}) }
            }
          },
          _sum: { amount: true },
          orderBy: { _sum: { amount: "desc" } }
        });
        for (const row of rows) grouped.push({ categoryId: row.categoryId, currency, amount: row._sum.amount ?? 0 });
      }
      const categoryIds = grouped.map((g) => g.categoryId).filter((id): id is string => id !== null);
      const categories = categoryIds.length
        ? await tx.financeCategory.findMany({ where: { id: { in: categoryIds } } })
        : [];
      const nameById = new Map(categories.map((c) => [c.id, c.name]));
      return grouped.map((g) => ({
        categoryId: g.categoryId,
        categoryName: g.categoryId ? (nameById.get(g.categoryId) ?? "Категория удалена") : "Без категории",
        currency: g.currency,
        amount: g.amount
      }));
    });
  }
}

async function sumLines(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  type: "income" | "expense",
  range: { start: Date; end: Date },
  currency: string
): Promise<number> {
  const sum = await tx.transactionLine.aggregate({
    where: { workspaceId, transaction: { type, account: { currency }, occurredAt: { gte: range.start, lt: range.end } } },
    _sum: { amount: true }
  });
  return sum._sum.amount ?? 0;
}

/** Transfers in this period from another currency into `currency` ("in") or out of `currency` into another ("out"). */
async function sumCrossCurrencyTransfers(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  range: { start: Date; end: Date },
  currency: string,
  direction: "in" | "out"
): Promise<number> {
  const accounts =
    direction === "in"
      ? { account: { currency: { not: currency } }, toAccount: { is: { currency } } }
      : { account: { currency }, toAccount: { is: { currency: { not: currency } } } };
  const sum = await tx.transactionLine.aggregate({
    where: { workspaceId, transaction: { type: "transfer", ...accounts, occurredAt: { gte: range.start, lt: range.end } } },
    _sum: { amount: true }
  });
  return sum._sum.amount ?? 0;
}

/** `count` "YYYY-MM" keys, oldest first, ending with the current calendar month. */
function lastMonthKeys(count: number): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(toMonthKey(d));
  }
  return keys;
}

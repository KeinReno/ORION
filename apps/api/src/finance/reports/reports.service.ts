import { Injectable } from "@nestjs/common";
import { DEFAULT_FINANCE_CURRENCY, type CategoryBreakdownEntry, type MonthlyFinanceSummary } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { explicitRange, monthRange, toMonthKey } from "../finance-refs.util";

const MAX_MONTHS = 24;

interface MonthlyTotal {
  month: string;
  currency: string;
  income: bigint;
  expense: bigint;
  transfer: bigint;
}

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
      const start = monthRange(keys[0])!.start;
      const end = monthRange(keys[keys.length - 1])!.end;
      // Resolve transaction and account visibility once per transaction under RLS.
      // Joining lines afterwards avoids rechecking those policies for each aggregate.
      const totals = await tx.$queryRaw<MonthlyTotal[]>`
        WITH visible_transactions AS MATERIALIZED (
          SELECT t.id, t.type, to_char(t."occurredAt", 'YYYY-MM') AS month,
            source.currency, destination.currency AS destination_currency
          FROM "finance_transactions" t
          JOIN "finance_accounts" source ON source.id = t."accountId"
          LEFT JOIN "finance_accounts" destination ON destination.id = t."toAccountId"
          WHERE t."workspaceId" = ${workspaceId}
            AND t."occurredAt" >= ${start.toISOString()}::timestamp
            AND t."occurredAt" < ${end.toISOString()}::timestamp
            AND (t.type <> 'transfer' OR source.currency <> destination.currency)
        ), amounts AS (
          SELECT t.month, t.currency, t.destination_currency, t.type, sum(l.amount) AS total
          FROM visible_transactions t
          JOIN "finance_transaction_lines" l ON l."transactionId" = t.id
          WHERE l."workspaceId" = ${workspaceId}
          GROUP BY t.month, t.currency, t.destination_currency, t.type
        ), flows AS (
          SELECT month, currency,
            CASE WHEN type = 'income' THEN total ELSE 0 END AS income,
            CASE WHEN type = 'expense' THEN total ELSE 0 END AS expense,
            CASE WHEN type = 'transfer' THEN -total ELSE 0 END AS transfer
          FROM amounts
          UNION ALL
          SELECT month, destination_currency, 0, 0, total FROM amounts WHERE type = 'transfer'
        )
        SELECT month, currency, sum(income)::bigint AS income, sum(expense)::bigint AS expense,
          sum(transfer)::bigint AS transfer
        FROM flows
        GROUP BY month, currency
      `;
      const byCurrencyMonth = new Map(totals.map((row) => [`${row.currency}:${row.month}`, row]));
      const results: MonthlyFinanceSummary[] = [];
      for (const { currency, starting } of currencies) {
        let netWorth = starting;
        for (const key of keys) {
          const month = byCurrencyMonth.get(`${currency}:${key}`);
          const income = Number(month?.income ?? 0);
          const expense = Number(month?.expense ?? 0);
          netWorth += income - expense + Number(month?.transfer ?? 0);
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

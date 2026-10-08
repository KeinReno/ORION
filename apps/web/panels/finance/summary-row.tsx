"use client";

import { useAccounts, useBudgets, useMonthlyFinanceSummary } from "@orion/core-react";
import { StatCard } from "@orion/ui";
import { useMemo } from "react";
import { formatMoney, sumByCurrency } from "../../lib/format";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Always-visible balance/spend/budget glance above the tab switcher — so
 * "how much money do I have" doesn't require opening the Accounts tab.
 * Balances are grouped by currency via `sumByCurrency` (accounts aren't all
 * RUB, see `Account.currency`) — DashboardPanel's finance card used to skip
 * this and sum raw balances across currencies into one misleading number
 * (fixed in S16, see docs/SONNET_IMPLEMENTATION/12-PROGRESS.md).
 *
 * "Расход в этом месяце" (`monthly.expense`) is a *different*, still-open
 * instance of the same bug: `ReportsService.monthlySummary` sums
 * `TransactionLine.amount` across every account in the workspace regardless
 * of currency (see reports.service.ts `sumLines`) — for a single-currency
 * workspace (the common case) that's correct; for a genuinely multi-
 * currency one it silently mixes currencies into one number. Rather than
 * print a wrong figure with an implied ₽, this hides that one stat when the
 * workspace demonstrably holds more than one currency (see
 * `balancesByCurrency.length > 1` below) — an honest gap, not a fix of the
 * report/budget aggregation itself, which would need an API shape change
 * (`MonthlyFinanceSummary`/`CategoryBreakdownEntry`/`Budget.spent` all have
 * the same "no currency dimension" issue) — left TODO, see S16 entry.
 */
export function FinanceSummaryRow(): React.ReactElement | null {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { data: accounts } = useAccounts(workspaceId);
  const { data: monthly } = useMonthlyFinanceSummary(workspaceId, 1);
  const { data: budgets } = useBudgets(workspaceId, currentMonthKey());

  const balancesByCurrency = useMemo(
    () => sumByCurrency(accounts ?? [], (a) => a.currency, (a) => a.balance),
    [accounts]
  );

  if (!accounts || accounts.length === 0) return null;

  const currentMonth = monthly?.[0];
  const overBudgetCount = (budgets ?? []).filter((b) => b.spent > b.limitAmount).length;

  return (
    <div className="grid grid-cols-2 gap-3 [@container(min-width:576px)]:grid-cols-4">
      {balancesByCurrency.map(([currency, total]) => (
        <StatCard
          key={currency}
          label={balancesByCurrency.length > 1 ? `Баланс, ${currency}` : "Баланс"}
          value={formatMoney(total, currency)}
        />
      ))}
      {currentMonth && balancesByCurrency.length <= 1 ? (
        <StatCard
          label="Расход в этом месяце"
          value={formatMoney(currentMonth.expense, balancesByCurrency[0]?.[0])}
        />
      ) : null}
      {budgets && budgets.length > 0 ? (
        <StatCard
          label="Бюджеты"
          value={
            <span className={overBudgetCount > 0 ? "text-destructive" : undefined}>
              {budgets.length - overBudgetCount} / {budgets.length}
            </span>
          }
          hint={overBudgetCount > 0 ? `превышено: ${overBudgetCount}` : "в норме"}
          className={overBudgetCount > 0 ? "border-destructive/30" : undefined}
        />
      ) : null}
    </div>
  );
}

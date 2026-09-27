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
 * "Расход в этом месяце" is per currency too: `ReportsService.monthlySummary`
 * returns one row per (month, account currency), so a RUB+USD workspace gets
 * "Расход, RUB" and "Расход, USD" instead of one mixed number.
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

  // `monthly` for one month = one row per currency. With several currencies,
  // skip the ones with no spend so a dormant USD account doesn't add a "0 $"
  // card; a single-currency workspace keeps its card even at zero.
  const spendByCurrency = (monthly ?? []).filter((m, _, all) => all.length === 1 || m.expense > 0);
  const overBudgetCount = (budgets ?? []).filter((b) => b.spent > b.limitAmount).length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {balancesByCurrency.map(([currency, total]) => (
        <StatCard
          key={currency}
          label={balancesByCurrency.length > 1 ? `Баланс, ${currency}` : "Баланс"}
          value={formatMoney(total, currency)}
        />
      ))}
      {spendByCurrency.map((row) => (
        <StatCard
          key={`spend-${row.currency}`}
          label={balancesByCurrency.length > 1 ? `Расход за месяц, ${row.currency}` : "Расход в этом месяце"}
          value={formatMoney(row.expense, row.currency)}
        />
      ))}
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

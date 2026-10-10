"use client";

import { useBudgets } from "@orion/core-react";
import { StatCard, cx } from "@orion/ui";
import type { DashboardFinanceSlotProps, FinanceSummarySlotProps } from "../../lib/extensions/contracts";

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Plugin `finance-budgeting`: the «Бюджеты» card of the Finance summary row — how many limits are within bounds. */
export function BudgetSummaryStat({ workspaceId }: FinanceSummarySlotProps): React.ReactElement | null {
  const { data: budgets } = useBudgets(workspaceId, currentMonthKey());
  if (!budgets || budgets.length === 0) return null;
  const overBudgetCount = budgets.filter((b) => b.spent > b.limitAmount).length;
  return (
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
  );
}

/** Plugin `finance-budgeting`: the budget line of the dashboard's «Финансы» card. */
export function BudgetDashboardLine({ workspaceId, month }: DashboardFinanceSlotProps): React.ReactElement | null {
  const { data: budgets } = useBudgets(workspaceId, month);
  if (!budgets || budgets.length === 0) return null;
  const overBudgetCount = budgets.filter((b) => b.spent > b.limitAmount).length;
  return (
    <p className={cx("mt-1 text-micro", overBudgetCount > 0 ? "text-destructive" : "text-muted-foreground")}>
      {overBudgetCount > 0
        ? `Превышено бюджетов: ${overBudgetCount} из ${budgets.length}`
        : `Бюджеты месяца в норме (${budgets.length})`}
    </p>
  );
}

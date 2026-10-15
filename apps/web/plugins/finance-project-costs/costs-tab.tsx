"use client";

import { useProject, useProjectCosts, useTimeEntriesSummary } from "@orion/core-react";
import { projectCostBalance, timeCostMinor, formatDuration } from "@orion/shared-types";
import { Card, EmptyState, Skeleton } from "@orion/ui";
import { Wallet } from "lucide-react";
import type { ProjectTabSlotProps } from "../../lib/extensions/contracts";
import { formatMoney, openPanel, useEnabledModules } from "../../lib/extensions/host-api";

/**
 * Plugin `finance-project-costs`: what the project cost. Money comes from the operations booked to it (exact server
 * sums, transfers excluded). The time worked, priced by the project's hourly rate, is shown SEPARATELY — it is an
 * estimate of labour, not money that left an account, so it is never added into the totals. An unknown rate is
 * «не задана», not zero.
 */
export function ProjectCostsTab({ workspaceId, projectId }: ProjectTabSlotProps): React.ReactElement {
  const { isEnabled } = useEnabledModules();
  const timeOn = isEnabled("time");
  const { data: costs, isLoading, isError } = useProjectCosts(workspaceId, projectId);
  const { data: project } = useProject(workspaceId, projectId);
  const { data: time } = useTimeEntriesSummary(timeOn ? workspaceId : undefined, { projectId });

  if (isLoading) return <Skeleton className="h-40" />;
  if (isError || !costs) return <EmptyState icon={Wallet} title="Не удалось загрузить затраты" description="Попробуйте открыть вкладку ещё раз." />;
  if (costs.operationCount === 0 && !(time && time.minutes > 0)) {
    return (
      <EmptyState
        icon={Wallet}
        title="Операций по проекту нет"
        description="Выберите проект в форме операции — и затраты появятся здесь."
      />
    );
  }

  const currency = costs.currency ?? "RUB";
  const balance = projectCostBalance(costs);
  const labour = time ? timeCostMinor(time.minutes, project?.hourlyRate) : null;
  const biggest = costs.expenseByCategory[0]?.amount ?? 0;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {costs.mixedCurrencies ? (
        <p className="text-xs text-warning">Операции проекта проведены по счетам в разных валютах — суммы ниже сложены без пересчёта и приблизительны.</p>
      ) : null}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))]">
        <Card className="space-y-1">
          <p className="text-2xs text-subtle-foreground">Потрачено</p>
          <p className="font-mono text-lg font-semibold tabular-nums text-destructive">{formatMoney(costs.expense, currency)}</p>
        </Card>
        <Card className="space-y-1">
          <p className="text-2xs text-subtle-foreground">Получено</p>
          <p className="font-mono text-lg font-semibold tabular-nums text-success">{formatMoney(costs.income, currency)}</p>
        </Card>
        <Card className="space-y-1">
          <p className="text-2xs text-subtle-foreground">Итог</p>
          <p className={`font-mono text-lg font-semibold tabular-nums ${balance < 0 ? "text-destructive" : "text-foreground"}`}>
            {balance > 0 ? "+" : balance < 0 ? "−" : ""}
            {formatMoney(Math.abs(balance), currency)}
          </p>
        </Card>
      </div>

      {costs.expenseByCategory.length > 0 ? (
        <Card className="space-y-2">
          <p className="text-sm font-medium text-foreground">Расходы по категориям</p>
          <ul className="space-y-1.5">
            {costs.expenseByCategory.map((entry) => (
              <li key={entry.categoryId ?? "none"} className="space-y-0.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-muted-foreground">{entry.categoryName}</span>
                  <span className="font-mono tabular-nums text-foreground">{formatMoney(entry.amount, currency)}</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-white/5">
                  <div className="h-full rounded-full bg-accent/60" style={{ width: `${biggest > 0 ? Math.max(2, (entry.amount / biggest) * 100) : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {timeOn && time && time.minutes > 0 ? (
        <Card className="space-y-1">
          <p className="text-sm font-medium text-foreground">Время работы</p>
          <p className="text-xs text-muted-foreground">
            {formatDuration(time.minutes)}
            {labour !== null ? ` · по ставке проекта ≈ ${formatMoney(labour, currency)}` : " · ставка проекта не задана, стоимость не считается"}
          </p>
          <p className="text-2xs text-subtle-foreground">Это оценка труда, а не списание со счёта: в «Потрачено» она не входит.</p>
        </Card>
      ) : null}

      <button type="button" onClick={() => openPanel("finance", "Финансы")} className="self-start text-2xs font-medium text-accent-text hover:text-accent-hover">
        Открыть операции в «Финансах»
      </button>
    </div>
  );
}

"use client";

import { useAccounts, useMonthlyFinanceSummary, useObligations } from "@orion/core-react";
import { Card, EmptyState, Skeleton } from "@orion/ui";
import { LineChart } from "lucide-react";
import { useMemo } from "react";
import { buildForecast, plannedPayments } from "../../lib/extensions/host-api";
import { formatMoney, shortDate } from "../../lib/extensions/host-api";
import type { FinanceTabSlotProps } from "../../lib/extensions/contracts";
import { useActiveWorkspace } from "../../lib/extensions/host-api";

const MONTH_NAMES = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

function monthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return `${MONTH_NAMES[index! - 1]} ${year}`;
}

/**
 * Plugin `finance-forecast`: where the balance is heading, with the method written out. It carries your own average
 * month forward and brackets it with your worst and best month; it does not guess. The planned payments of your
 * obligations are listed apart and are NOT in the balance (they have not happened, and their past is already in the
 * average expense — adding them would count them twice). Needs a single currency: operation history is not split by it.
 */
export function ForecastView({ workspaceId }: FinanceTabSlotProps): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const id = workspaceId ?? workspace?.id;
  const { data: accounts } = useAccounts(id);
  const { data: monthly, isLoading } = useMonthlyFinanceSummary(id, 7);
  const { data: obligations } = useObligations(id);
  const now = useMemo(() => new Date(), []);

  const currencies = useMemo(() => [...new Set((accounts ?? []).map((account) => account.currency))], [accounts]);
  const currency = currencies[0] ?? "RUB";
  const balance = (accounts ?? []).reduce((sum, account) => sum + account.balance, 0);
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  // The running month is incomplete and would pull the average expense down: only finished months are the basis.
  const history = (monthly ?? []).filter((entry) => entry.month < currentMonth).map((entry) => ({ month: entry.month, income: entry.income, expense: entry.expense }));
  const forecast = useMemo(() => buildForecast(history, balance, now, 6), [history, balance, now]);
  const planned = useMemo(() => plannedPayments(obligations ?? [], new Date(now.getFullYear(), now.getMonth() + 7, 0)), [obligations, now]);
  const plannedOwe = planned.filter((p) => p.direction === "owe").reduce((sum, p) => sum + p.amount, 0);
  const plannedOwed = planned.filter((p) => p.direction === "owed").reduce((sum, p) => sum + p.amount, 0);

  if (isLoading) return <Skeleton className="h-40" />;
  if (currencies.length > 1) {
    return (
      <EmptyState
        icon={LineChart}
        title="Прогноз — по одной валюте"
        description={`У вас счета в разных валютах (${currencies.join(", ")}), а история доходов и расходов не разделена по валютам: честный прогноз пока невозможен. Оставьте счета в одной валюте или смотрите отчёты.`}
      />
    );
  }
  if (forecast.points.length === 0) {
    return <EmptyState icon={LineChart} title="Пока не из чего считать" description={forecast.warnings[0] ?? "Нужна история операций хотя бы за месяц."} />;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card className="space-y-2">
        <p className="text-sm font-medium text-foreground">Как считается</p>
        <p className="text-xs text-muted-foreground">
          Взяты последние полные месяцы ({forecast.basis.length}): в среднем доход {formatMoney(forecast.averageIncome, currency)}, расход{" "}
          {formatMoney(forecast.averageExpense, currency)}, итог {formatMoney(forecast.averageNet, currency)} в месяц. Коридор — если каждый месяц будет
          как худший или как лучший из них. Это арифметика по вашей истории, а не предсказание.
        </p>
        {forecast.warnings.map((warning) => (
          <p key={warning} className="text-xs text-warning">
            {warning}
          </p>
        ))}
      </Card>

      <Card className="space-y-2">
        <p className="text-sm font-medium text-foreground">Остаток на конец месяца · сейчас {formatMoney(balance, currency)}</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-subtle-foreground">
              <th className="py-1 font-normal">Месяц</th>
              <th className="py-1 text-right font-normal">Ожидаемо</th>
              <th className="py-1 text-right font-normal">Хуже</th>
              <th className="py-1 text-right font-normal">Лучше</th>
            </tr>
          </thead>
          <tbody>
            {forecast.points.map((point) => (
              <tr key={point.month} className="border-t border-border">
                <td className="py-1.5 text-foreground">{monthLabel(point.month)}</td>
                <td className={`py-1.5 text-right font-mono tabular-nums ${point.balance < 0 ? "text-destructive" : "text-foreground"}`}>{formatMoney(point.balance, currency)}</td>
                <td className={`py-1.5 text-right font-mono tabular-nums ${point.low < 0 ? "text-destructive" : "text-muted-foreground"}`}>{formatMoney(point.low, currency)}</td>
                <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">{formatMoney(point.high, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="space-y-2">
        <p className="text-sm font-medium text-foreground">Из каких месяцев взято</p>
        <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          {forecast.basis.map((entry) => (
            <li key={entry.month} className="flex justify-between gap-2">
              <span>{monthLabel(entry.month)}</span>
              <span className="font-mono tabular-nums">
                +{formatMoney(entry.income, currency)} / −{formatMoney(entry.expense, currency)}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {planned.length > 0 ? (
        <Card className="space-y-2">
          <p className="text-sm font-medium text-foreground">Плановые платежи до конца горизонта (в остаток не входят)</p>
          <p className="text-xs text-muted-foreground">
            К оплате {formatMoney(plannedOwe, currency)}
            {plannedOwed ? ` · ожидается получить ${formatMoney(plannedOwed, currency)}` : ""}
          </p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {planned.slice(0, 12).map((payment) => (
              <li key={`${payment.obligationId}:${payment.dueAt}`} className="flex justify-between gap-2">
                <span>
                  {shortDate(payment.dueAt)} · {payment.name}
                </span>
                <span className="font-mono tabular-nums">
                  {payment.direction === "owed" ? "+" : "−"}
                  {formatMoney(payment.amount, currency)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

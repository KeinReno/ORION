"use client";

import { useCategoryBreakdown, useFinanceCurrency, useMonthlyFinanceSummary } from "@orion/core-react";
import { financeRowCurrencies } from "@orion/shared-types";
import { EmptyState, IconButton, SegmentedControl, Skeleton } from "@orion/ui";
import { BarChart3, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { formatMoney, projectColor } from "../../lib/extensions/host-api";
import { ReportInsights } from "./insights";
import { useActiveWorkspace } from "../../lib/extensions/host-api";

const MONTHS = 6;

function monthShortLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("ru-RU", { month: "short" });
}

function monthFullLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonthKey(month: string, delta: number): string {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Two hand-rolled SVG charts, no charting library (same rule as
 * Calendar/TiltCard — ORION doesn't add a runtime dependency for a visual
 * that a few dozen lines of SVG can do): a grouped income/expense bar chart
 * and a net worth trend line, both over the last `MONTHS` months, plus a
 * horizontal-bar breakdown of the current month's expenses by category.
 */
export function ReportsView(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const { data: monthly, isLoading: monthlyLoading } = useMonthlyFinanceSummary(workspace?.id, MONTHS);
  // Independent of the monthly summary's last month — the user may want to
  // look at a category breakdown for any month, not just the most recent one.
  const [breakdownMonth, setBreakdownMonth] = useState(currentMonthKey());
  const { data: breakdown, isLoading: breakdownLoading } = useCategoryBreakdown(workspace?.id, { month: breakdownMonth });

  // The server returns one series per account currency (see
  // monthlyFinanceSummarySchema) — the charts show one currency at a time,
  // never a sum across them. Default is the workspace's primary currency (the
  // one most of its accounts are in, `useFinanceCurrency`); the switcher
  // appears only with more than one, so a single-currency workspace sees the
  // report exactly as before.
  const currencies = useMemo(() => financeRowCurrencies(monthly ?? []), [monthly]);
  const { currency, setCurrency } = useFinanceCurrency(workspace?.id, currencies);
  const series = (monthly ?? []).filter((m) => m.currency === currency);
  const entries = (breakdown ?? []).filter((e) => e.currency === currency);

  const hasData = (monthly ?? []).some((m) => m.income > 0 || m.expense > 0);

  if (monthlyLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!hasData || !currency) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Пока не из чего строить отчёт"
        description="Добавьте несколько операций во вкладке «Транзакции» — здесь появятся графики."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {currencies.length > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-2xs text-subtle-foreground">Счета в разных валютах — отчёт строится по каждой отдельно.</p>
          <SegmentedControl<string>
            size="sm"
            aria-label="Валюта отчёта"
            options={currencies.map((c) => ({ value: c, label: c }))}
            value={currency}
            onChange={setCurrency}
          />
        </div>
      ) : null}
      <IncomeExpenseChart data={series} currency={currency} />
      <NetWorthChart data={series} currency={currency} />
      <CategoryBreakdown
        month={breakdownMonth}
        onShiftMonth={(delta) => setBreakdownMonth((m) => shiftMonthKey(m, delta))}
        entries={entries}
        currency={currency}
        loading={breakdownLoading}
      />
      <ReportInsights workspaceId={workspace?.id} month={breakdownMonth} currency={currency} />
    </div>
  );
}

const CHART_WIDTH = 600;
const CHART_HEIGHT = 180;
const CHART_PAD = 24;

function IncomeExpenseChart({
  data,
  currency
}: {
  data: { month: string; income: number; expense: number }[];
  currency: string;
}): React.ReactElement {
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
  const groupWidth = (CHART_WIDTH - CHART_PAD * 2) / data.length;
  const barWidth = Math.min(18, groupWidth / 3);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Доходы и расходы по месяцам</p>
        <div className="flex items-center gap-3 text-2xs text-subtle-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-success" /> доход
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-destructive" /> расход
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-40 w-full" role="img" aria-label="Доходы и расходы по месяцам">
        {data.map((d, i) => {
          const groupX = CHART_PAD + i * groupWidth;
          const incomeHeight = (d.income / max) * (CHART_HEIGHT - CHART_PAD * 2);
          const expenseHeight = (d.expense / max) * (CHART_HEIGHT - CHART_PAD * 2);
          const baseY = CHART_HEIGHT - CHART_PAD;
          return (
            <g key={d.month}>
              <rect
                x={groupX + groupWidth / 2 - barWidth - 2}
                y={baseY - incomeHeight}
                width={barWidth}
                height={Math.max(incomeHeight, 1)}
                rx={2}
                className="fill-success"
              >
                <title>{`${monthFullLabel(d.month)} · доход: ${formatMoney(d.income, currency)}`}</title>
              </rect>
              <rect
                x={groupX + groupWidth / 2 + 2}
                y={baseY - expenseHeight}
                width={barWidth}
                height={Math.max(expenseHeight, 1)}
                rx={2}
                className="fill-destructive"
              >
                <title>{`${monthFullLabel(d.month)} · расход: ${formatMoney(d.expense, currency)}`}</title>
              </rect>
              <text
                x={groupX + groupWidth / 2}
                y={CHART_HEIGHT - 4}
                textAnchor="middle"
                className="fill-subtle-foreground text-2xs capitalize"
              >
                {monthShortLabel(d.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function NetWorthChart({ data, currency }: { data: { month: string; netWorth: number }[]; currency: string }): React.ReactElement {
  const values = data.map((d) => d.netWorth);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const stepX = (CHART_WIDTH - CHART_PAD * 2) / Math.max(1, data.length - 1);

  const points = data.map((d, i) => {
    const x = CHART_PAD + i * stepX;
    const y = CHART_HEIGHT - CHART_PAD - ((d.netWorth - min) / range) * (CHART_HEIGHT - CHART_PAD * 2);
    return { x, y, value: d.netWorth };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const last = points[points.length - 1];

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Чистый капитал</p>
        {last ? <p className="text-sm font-semibold text-foreground">{formatMoney(last.value, currency)}</p> : null}
      </div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-32 w-full" role="img" aria-label="Чистый капитал по месяцам">
        <path d={path} fill="none" strokeWidth={2} className="stroke-accent" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={8} fill="transparent">
              <title>{`${monthFullLabel(data[i].month)} · ${formatMoney(p.value, currency)}`}</title>
            </circle>
            <circle cx={p.x} cy={p.y} r={3} className="fill-accent" />
          </g>
        ))}
        {data.map((d, i) => (
          <text
            key={d.month}
            x={CHART_PAD + i * stepX}
            y={CHART_HEIGHT - 4}
            textAnchor="middle"
            className="fill-subtle-foreground text-2xs capitalize"
          >
            {monthShortLabel(d.month)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function CategoryBreakdown({
  month,
  onShiftMonth,
  entries,
  currency,
  loading
}: {
  month: string;
  onShiftMonth: (delta: number) => void;
  entries: { categoryId: string | null; categoryName: string; amount: number }[];
  currency: string;
  loading: boolean;
}): React.ReactElement {
  const max = Math.max(1, ...entries.map((e) => e.amount));
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Расходы по категориям</p>
        <div className="flex items-center gap-1">
          <IconButton label="Предыдущий месяц" size="sm" onClick={() => onShiftMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <span className="min-w-[7rem] text-center text-2xs font-medium capitalize text-foreground">{monthFullLabel(month)}</span>
          <IconButton label="Следующий месяц" size="sm" onClick={() => onShiftMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">В этом месяце расходов не было.</p>
      ) : (
        <div className="space-y-2.5">
          {entries.map((entry) => {
            const key = entry.categoryId ?? entry.categoryName;
            // Same hash-based colour as the category chips elsewhere (Transactions list,
            // Notes tags) — works for "Без категории" too, it's just a string hash.
            const tone = projectColor(entry.categoryName);
            return (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between text-2xs">
                  <span className="text-muted-foreground">{entry.categoryName}</span>
                  <span className="tabular-nums text-subtle-foreground">{formatMoney(entry.amount, currency)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full transition-[width] duration-500 ease-out"
                    style={{ width: `${(entry.amount / max) * 100}%`, background: tone.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

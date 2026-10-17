"use client";

import { useAccounts, useExchangeRates, useMonthlyFinanceSummary, useObligations } from "@orion/core-react";
import { formatRate } from "@orion/shared-types";
import { Card, EmptyState, Select, Skeleton, StatCard } from "@orion/ui";
import { Landmark } from "lucide-react";
import { useMemo, useState } from "react";
import type { DashboardFinanceSlotProps, FinanceTabSlotProps } from "../../lib/extensions/contracts";
import { assetShares, buildNetWorth, convertNetWorth, formatMoney, shortDate, useActiveWorkspace, useEnabledModules } from "../../lib/extensions/host-api";

const KIND_LABEL = { cash: "Наличные", card: "Карты", savings: "Накопления", other: "Прочее" } as const;
const MONTHS = 12;

/** Obligations are a plugin of their own: without it the capital is the accounts alone, and says so. */
function useNetWorthData(workspaceId: string | undefined) {
  const { data: accounts, isLoading } = useAccounts(workspaceId);
  // `useObligations` is gated server-side by finance-obligations; a 409 simply leaves the list empty.
  const { data: obligations } = useObligations(workspaceId);
  const worth = useMemo(() => buildNetWorth(accounts ?? [], obligations ?? []), [accounts, obligations]);
  return { accounts: accounts ?? [], worth, isLoading };
}

/**
 * Plugin `finance-net-worth`: what the workspace is worth right now, per currency — accounts minus debts plus
 * receivables — and how the account side moved over the last year. The trend is the accounts' running balance only:
 * the history of debts is not stored, so past months deliberately do not subtract them. The monthly summary comes one
 * series per account currency, and each currency gets its own trend — never one line through mixed amounts.
 */
export function NetWorthView({ workspaceId }: FinanceTabSlotProps): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const id = workspaceId ?? workspace?.id;
  const { accounts, worth, isLoading } = useNetWorthData(id);
  const { data: monthly } = useMonthlyFinanceSummary(id, MONTHS);
  // Hand-entered rates (plugin «Курсы валют»); with the plugin off the list is empty and nothing is converted.
  const { data: rates } = useExchangeRates(worth.currencies.length > 1 ? id : undefined);
  const [target, setTarget] = useState("");
  const onDay = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const converted = useMemo(
    () => (target && rates && rates.length > 0 ? convertNetWorth(worth, target, rates, onDay) : null),
    [target, rates, worth, onDay]
  );

  if (isLoading) return <Skeleton className="h-40" />;
  if (worth.currencies.length === 0) {
    return <EmptyState icon={Landmark} title="Капитала пока нет" description="Заведите счёт с остатком — и здесь появится картина: что у вас есть и что вы должны." />;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {worth.currencies.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Итог в одной валюте:</span>
          <Select aria-label="Показать капитал в валюте" value={target} onChange={(e) => setTarget(e.target.value)} className="w-28">
            <option value="">по отдельности</option>
            {worth.currencies.map((entry) => (
              <option key={entry.currency} value={entry.currency}>
                {entry.currency}
              </option>
            ))}
          </Select>
          {!rates || rates.length === 0 ? <span className="text-subtle-foreground">нужны курсы — вкладка «Курсы» (плагин «Курсы валют»)</span> : null}
        </div>
      ) : null}

      {converted ? (
        <section className="space-y-2" aria-label={`Капитал в ${converted.currency}`}>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))]">
            <StatCard label={`Чистый капитал, ${converted.currency}`} value={<span className={converted.net < 0 ? "text-destructive" : undefined}>{formatMoney(converted.net, converted.currency)}</span>} />
            <StatCard label="На счетах" value={formatMoney(converted.assets, converted.currency)} />
            <StatCard label="Я должен" value={formatMoney(converted.owe, converted.currency)} />
            <StatCard label="Мне должны" value={formatMoney(converted.owed, converted.currency)} />
          </div>
          {converted.missing.length > 0 ? (
            <p className="text-xs text-warning">Нет курса для {converted.missing.join(", ")} — эти деньги в итог не вошли. Введите курс во вкладке «Курсы».</p>
          ) : null}
          {converted.used.length > 0 ? (
            <p className="text-2xs text-subtle-foreground">
              По вашим курсам:{" "}
              {converted.used
                .map((item) => {
                  const pair = item.lookup.inverse
                    ? `1 ${converted.currency} = ${formatRate(item.lookup.rateMicro)} ${item.from}`
                    : `1 ${item.from} = ${formatRate(item.lookup.rateMicro)} ${converted.currency}`;
                  return `${pair} (от ${shortDate(`${item.lookup.day}T12:00:00.000Z`)})`;
                })
                .join("; ")}
              .
            </p>
          ) : null}
        </section>
      ) : null}

      {(converted ? [] : worth.currencies).map((entry) => (
        <section key={entry.currency} className="space-y-2">
          {worth.currencies.length > 1 ? <p className="text-xs font-medium text-muted-foreground">{entry.currency}</p> : null}
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))]">
            <StatCard label="Чистый капитал" value={<span className={entry.net < 0 ? "text-destructive" : undefined}>{formatMoney(entry.net, entry.currency)}</span>} />
            <StatCard label="На счетах" value={formatMoney(entry.assets, entry.currency)} hint={entry.accountDebt > 0 ? `овердрафт −${formatMoney(entry.accountDebt, entry.currency)}` : undefined} />
            <StatCard label="Я должен" value={formatMoney(entry.owe, entry.currency)} />
            <StatCard label="Мне должны" value={formatMoney(entry.owed, entry.currency)} />
          </div>
          <Shares accounts={accounts} currency={entry.currency} />
        </section>
      ))}

      {worth.unassigned.length > 0 ? (
        <p className="text-xs text-warning">
          Обязательств без счёта: {worth.unassigned.length}. Счета в разных валютах, а валюта обязательства не задана, поэтому они не входят в итоги — привяжите их к счёту.
        </p>
      ) : null}
      {worth.untracked > 0 ? <p className="text-2xs text-subtle-foreground">Ещё {worth.untracked} без общей суммы (подписки, коммунальные) — в капитал не входят.</p> : null}

      {(converted ? [] : worth.currencies).map((entry) => {
        const series = (monthly ?? []).filter((m) => m.currency === entry.currency);
        if (series.length <= 1) return null;
        return (
          <Card key={`trend-${entry.currency}`} className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              Динамика счетов{worth.currencies.length > 1 ? ` в ${entry.currency}` : ""} за {series.length} мес.
            </p>
            <Trend points={series.map((m) => m.netWorth)} currency={entry.currency} first={series[0]!.month} last={series[series.length - 1]!.month} />
            <p className="text-2xs text-subtle-foreground">Только остатки счетов: история долгов не хранится, поэтому прошлые месяцы их не вычитают.</p>
          </Card>
        );
      })}
    </div>
  );
}

function Shares({ accounts, currency }: { accounts: Parameters<typeof assetShares>[0]; currency: string }): React.ReactElement | null {
  const shares = assetShares(accounts, currency);
  if (shares.length === 0) return null;
  return (
    <Card className="space-y-2">
      <p className="text-sm font-medium text-foreground">Где лежат деньги</p>
      <ul className="space-y-1.5">
        {shares.map((row) => (
          <li key={row.kind} className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{KIND_LABEL[row.kind]}</span>
              <span className="font-mono tabular-nums text-foreground">
                {formatMoney(row.amount, currency)} · {Math.round(row.share * 100)}%
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full bg-accent/60" style={{ width: `${Math.max(2, row.share * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** A hand-rolled SVG line (ORION adds no charting dependency for this). */
function Trend({ points, currency, first, last }: { points: number[]; currency: string; first: string; last: string }): React.ReactElement {
  const width = 600;
  const height = 120;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points
    .map((value, index) => `${index === 0 ? "M" : "L"}${(index / (points.length - 1)) * width},${height - ((value - min) / span) * (height - 12) - 6}`)
    .join(" ");
  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-28 w-full"
        role="img"
        aria-label={`Остаток на счетах: от ${formatMoney(points[0]!, currency)} до ${formatMoney(points[points.length - 1]!, currency)}`}
      >
        <path d={path} fill="none" stroke="currentColor" strokeWidth={2} className="text-accent-text" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-2xs text-subtle-foreground">
        <span>
          {first} · {formatMoney(points[0]!, currency)}
        </span>
        <span>
          {last} · {formatMoney(points[points.length - 1]!, currency)}
        </span>
      </div>
    </div>
  );
}

/** The dashboard's «Финансы» card: one line with the net worth (a single currency only — never a mixed total). */
export function NetWorthDashboardLine({ workspaceId }: DashboardFinanceSlotProps): React.ReactElement | null {
  const { isEnabled } = useEnabledModules();
  const { worth } = useNetWorthData(isEnabled("finance") ? workspaceId : undefined);
  if (worth.currencies.length !== 1) return null;
  const entry = worth.currencies[0]!;
  return (
    <p className="mt-1 text-micro text-muted-foreground">
      Капитал: {formatMoney(entry.net, entry.currency)}
      {entry.owe > 0 ? ` · долги ${formatMoney(entry.owe, entry.currency)}` : ""}
    </p>
  );
}

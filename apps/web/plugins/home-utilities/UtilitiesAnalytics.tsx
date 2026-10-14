"use client";

import { useState } from "react";
import type { UtilityMonth } from "@orion/shared-types";
import { Card } from "@orion/ui";

const money = (minor: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(minor / 100);
const shortMonth = (period: string) => new Intl.DateTimeFormat("ru-RU", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));

export function UtilitiesAnalytics({ months }: { months: UtilityMonth[] }): React.ReactElement | null {
  const [range, setRange] = useState<6 | 12 | 0>(12);
  // A newly created, still empty month must not distort the historical averages.
  const history = [...months].filter((month) => month.grandTotalMinor > 0).sort((a, b) => a.period.localeCompare(b.period));
  if (history.length === 0) return null;
  const visible = range ? history.slice(-range) : history;
  const latest = history[history.length - 1];
  const first = history[0];
  const average = Math.round(history.reduce((sum, month) => sum + month.grandTotalMinor, 0) / history.length);
  const change = latest.grandTotalMinor - first.grandTotalMinor;
  const highest = history.reduce((max, month) => month.grandTotalMinor > max.grandTotalMinor ? month : max);
  const chartMax = Math.max(...visible.map((month) => month.grandTotalMinor)) * 1.08;
  const suppliers = [...latest.charges].sort((a, b) => b.amountMinor - a.amountMinor);
  const discrepancy = history.filter((month) =>
    (month.importedUtilityMinor !== null && month.importedUtilityMinor !== month.utilityMinor) ||
    (month.importedGrandTotalMinor !== null && month.importedGrandTotalMinor !== month.grandTotalMinor));

  return <Card className="space-y-5 p-4 [@container(min-width:700px)]:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h4 className="text-title">Аналитика квартплаты</h4><p className="text-2xs text-muted-foreground">Начисления по внесённым месяцам, включая черновики. Суммы рассчитаны из строк компаний.</p></div>
      <div className="flex rounded-lg border border-border p-1" role="group" aria-label="Период диаграммы">
        {([6, 12, 0] as const).map((value) => <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)} className={`rounded px-2.5 py-1 text-2xs ${range === value ? "bg-accent/20 text-accent" : "text-muted-foreground hover:bg-white/5"}`}>{value || "Все"}{value ? " мес." : ""}</button>)}
      </div>
    </div>
    <div className="grid gap-2 [@container(min-width:650px)]:grid-cols-3">
      <div className="rounded-lg border border-border/70 p-3"><span className="text-2xs text-muted-foreground">В среднем за месяц</span><strong className="mt-1 block text-lg tabular-nums">{money(average)}</strong></div>
      <div className="rounded-lg border border-border/70 p-3"><span className="text-2xs text-muted-foreground">Изменение с {shortMonth(first.period)}</span><strong className={`mt-1 block text-lg tabular-nums ${change > 0 ? "text-amber-400" : "text-emerald-400"}`}>{change > 0 ? "+" : ""}{money(change)}</strong></div>
      <div className="rounded-lg border border-border/70 p-3"><span className="text-2xs text-muted-foreground">Максимум · {shortMonth(highest.period)}</span><strong className="mt-1 block text-lg tabular-nums">{money(highest.grandTotalMinor)}</strong></div>
    </div>
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-accent" />Квартплата</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-cyan-400" />Коммуналка</span></div>
      <div className="overflow-x-auto pb-1"><div className="flex h-48 min-w-max items-end gap-2 border-b border-border px-1 pt-4" role="img" aria-label={`Диаграмма начислений за ${visible.length} месяцев: квартплата и коммунальные услуги`}>
        {visible.map((month) => <div key={month.id} className="group flex w-11 shrink-0 flex-col items-center gap-1" title={`${shortMonth(month.period)}: квартплата ${money(month.rentMinor)}, коммуналка ${money(month.utilityMinor)}, всего ${money(month.grandTotalMinor)}`}>
          <div className="flex w-7 flex-col-reverse overflow-hidden rounded-t-sm" style={{ height: `${Math.max(2, Math.round(month.grandTotalMinor / chartMax * 150))}px` }}><div className="bg-accent" style={{ height: `${month.rentMinor / month.grandTotalMinor * 100}%` }} /><div className="bg-cyan-400" style={{ height: `${month.utilityMinor / month.grandTotalMinor * 100}%` }} /></div>
          <span className="text-[10px] tabular-nums text-muted-foreground">{shortMonth(month.period)}</span>
        </div>)}
      </div></div>
    </div>
    <div className="space-y-2 border-t border-border/70 pt-4"><h5 className="text-label font-semibold">Коммуналка последнего внесённого месяца · {shortMonth(latest.period)}</h5><div className="grid gap-x-5 gap-y-2 [@container(min-width:650px)]:grid-cols-2">
      {suppliers.map((supplier) => <div key={supplier.id} className="min-w-0"><div className="mb-1 flex justify-between gap-2 text-2xs"><span className="truncate">{supplier.name}</span><span className="shrink-0 tabular-nums">{money(supplier.amountMinor)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-400" style={{ width: `${latest.utilityMinor ? supplier.amountMinor / latest.utilityMinor * 100 : 0}%` }} /></div></div>)}
    </div></div>
    {discrepancy.length > 0 ? <p className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-2xs text-amber-300">Сверьте итоги исходной таблицы: расхождения в {discrepancy.map((month) => shortMonth(month.period)).join(", ")}. Исходные значения сохранены в карточках месяцев.</p> : null}
  </Card>;
}

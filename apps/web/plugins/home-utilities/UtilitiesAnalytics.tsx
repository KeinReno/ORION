"use client";

import { useMemo, useState } from "react";
import type { UtilityMonth } from "@orion/shared-types";
import { Card } from "@orion/ui";
import { formatMoney } from "../../lib/extensions/host-api";
import {
  companySeries, foldCompanies, lastPoints, monthAxis, reconcile, rentShares, tariffImpacts, yearOverYear,
  type AxisPoint, type CompanySeries, type TariffChange
} from "./utilities-analytics";

const shortMonth = (period: string) => new Intl.DateTimeFormat("ru-RU", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));
const percent = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`;
const signed = (minor: number) => `${minor > 0 ? "+" : ""}${formatMoney(minor)}`;

/** Цвета серий: акцент темы и фиксированные семантические тона; цвет не единственный носитель смысла — есть таблицы. */
const SERIES_STYLES = [
  { fill: "fill-accent", bg: "bg-accent", stroke: "stroke-accent" },
  { fill: "fill-cyan-400", bg: "bg-cyan-400", stroke: "stroke-cyan-400" },
  { fill: "fill-success", bg: "bg-success", stroke: "stroke-success" },
  { fill: "fill-warning", bg: "bg-warning", stroke: "stroke-warning" },
  { fill: "fill-destructive", bg: "bg-destructive", stroke: "stroke-destructive" },
  { fill: "fill-violet-400", bg: "bg-violet-400", stroke: "stroke-violet-400" }
] as const;
const MAX_SERIES = SERIES_STYLES.length;

const SLOT = 30;
const LEFT = 58;
const TOP = 10;
const PLOT_H = 130;
const BOTTOM = 22;

function niceMax(value: number): number {
  if (value <= 0) return 100;
  const base = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * base >= value)!;
  return step * base;
}

interface ChartFrameProps {
  axis: AxisPoint[];
  maxMinor: number;
  label: string;
  markers?: TariffChange[];
  children: (geometry: { x: (index: number) => number; y: (minor: number) => number; bar: number }) => React.ReactNode;
}

/** Общая рамка: оси, сетка, подписи месяцев и вертикальные маркеры (смена тарифов). Пропуски остаются пустыми слотами. */
function ChartFrame({ axis, maxMinor, label, markers = [], children }: ChartFrameProps): React.ReactElement {
  const top = niceMax(maxMinor);
  const width = LEFT + axis.length * SLOT + 6;
  const height = TOP + PLOT_H + BOTTOM;
  const x = (index: number) => LEFT + index * SLOT;
  const y = (minor: number) => TOP + PLOT_H - (minor / top) * PLOT_H;
  const step = Math.ceil(axis.length / 12);
  const ticks = [0, 0.5, 1].map((part) => Math.round(top * part));
  return (
    <div className="overflow-x-auto pb-1">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} className="max-w-none" style={{ minWidth: Math.min(width, 320) }}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={LEFT} x2={width - 4} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} />
            <text x={LEFT - 4} y={y(tick) + 3} textAnchor="end" className="fill-subtle-foreground text-[9px] tabular-nums">{formatMoney(tick).replace(/,00(?=\s)/, "")}</text>
          </g>
        ))}
        {axis.map((point, index) => (index % step === 0 ? (
          <text key={point.period} x={x(index) + SLOT / 2} y={TOP + PLOT_H + 14} textAnchor="middle" className="fill-subtle-foreground text-[9px]">{shortMonth(point.period)}</text>
        ) : null))}
        {children({ x, y, bar: SLOT - 8 })}
        {markers.map((marker) => {
          const index = axis.findIndex((point) => point.period === marker.period);
          if (index < 0) return null;
          const mx = x(index);
          return (
            <g key={marker.period}>
              <title>{`${marker.label}: с ${shortMonth(marker.period)}`}</title>
              <line x1={mx} x2={mx} y1={TOP} y2={TOP + PLOT_H} className="stroke-warning" strokeWidth={1.5} strokeDasharray="4 3" />
              <path d={`M${mx - 4} ${TOP} h8 l-4 6 z`} className="fill-warning" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Legend({ items }: { items: { name: string; bg: string }[] }): React.ReactElement {
  return <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground">{items.map((item) => <li key={item.name}><i className={`mr-1 inline-block h-2.5 w-2.5 rounded-sm ${item.bg}`} aria-hidden />{item.name}</li>)}</ul>;
}

function Fallback({ summary, children }: { summary: string; children: React.ReactNode }): React.ReactElement {
  return <details className="mt-2 text-2xs"><summary className="cursor-pointer text-muted-foreground hover:text-foreground">{summary}</summary><div className="mt-2 overflow-x-auto">{children}</div></details>;
}

const th = "p-2 text-left font-medium";
const td = "p-2 tabular-nums";

function CompanyChart({ axis }: { axis: AxisPoint[] }): React.ReactElement {
  const series = useMemo(() => foldCompanies(companySeries(axis), MAX_SERIES), [axis]);
  const totals = axis.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const label = `Коммуналка по компаниям за ${axis.length} мес.: столбцы по месяцам, сегменты — ${series.map((s) => s.name).join(", ")}. Подробности в таблице под диаграммой.`;
  return (
    <figure>
      <figcaption className="mb-1 text-label font-semibold">Коммуналка по компаниям</figcaption>
      <Legend items={series.map((s, i) => ({ name: s.name, bg: SERIES_STYLES[i].bg }))} />
      <ChartFrame axis={axis} maxMinor={Math.max(0, ...totals)} label={label}>
        {({ x, y, bar }) => axis.map((point, index) => {
          if (!point.month) return null;
          let acc = 0;
          return (
            <g key={point.period}>
              <title>{`${shortMonth(point.period)}: ${series.map((s) => `${s.name} ${formatMoney(s.values[index] ?? 0)}`).join(", ")}; всего ${formatMoney(totals[index])}`}</title>
              {series.map((s, i) => {
                const value = s.values[index] ?? 0;
                if (value <= 0) return null;
                const top = y(acc + value);
                const h = y(acc) - top;
                acc += value;
                return <rect key={s.key} x={x(index) + 4} y={top} width={bar} height={Math.max(0.5, h)} className={SERIES_STYLES[i].fill} />;
              })}
            </g>
          );
        })}
      </ChartFrame>
      <Fallback summary="Таблица значений">
        <CompanyTable axis={axis} series={series} totals={totals} />
      </Fallback>
    </figure>
  );
}

function CompanyTable({ axis, series, totals }: { axis: AxisPoint[]; series: CompanySeries[]; totals: number[] }): React.ReactElement {
  return (
    <table className="w-full min-w-max">
      <thead className="text-muted-foreground"><tr><th className={th}>Месяц</th>{series.map((s) => <th key={s.key} className={th}>{s.name}</th>)}<th className={th}>Коммуналка</th></tr></thead>
      <tbody>{axis.map((point, index) => (
        <tr key={point.period} className="border-t border-border/60">
          <td className={td}>{shortMonth(point.period)}</td>
          {series.map((s) => <td key={s.key} className={`${td} text-right`}>{s.values[index] === null ? "нет данных" : formatMoney(s.values[index] ?? 0)}</td>)}
          <td className={`${td} text-right font-semibold`}>{point.month ? formatMoney(totals[index]) : "нет данных"}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

/** Линия, разрываемая в пропусках: неизвестный месяц не соединяется и не опускается в ноль. */
function segments(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string[] {
  const paths: string[] = [];
  let current = "";
  values.forEach((value, index) => {
    if (value === null) { if (current) paths.push(current); current = ""; return; }
    current += `${current ? "L" : "M"}${x(index) + SLOT / 2} ${y(value)} `;
  });
  if (current) paths.push(current);
  return paths;
}

function RentChart({ axis }: { axis: AxisPoint[] }): React.ReactElement {
  const shares = useMemo(() => rentShares(axis), [axis]);
  const totals = shares.map((s) => (s ? s.totalMinor : null));
  const rents = shares.map((s) => (s ? s.rentMinor : null));
  const known = shares.filter((s): s is NonNullable<typeof s> => s !== null && s.share !== null);
  const avgShare = known.length ? known.reduce((sum, s) => sum + (s.share ?? 0), 0) / known.length : null;
  const label = `Итог за месяц и квартплата, ${axis.length} мес. Доля коммуналки от квартплаты в среднем ${avgShare === null ? "неизвестна" : Math.round(avgShare * 100) + "%"}.`;
  return (
    <figure>
      <figcaption className="mb-1 text-label font-semibold">Итог за месяц и квартплата</figcaption>
      <Legend items={[{ name: "Общий итог", bg: SERIES_STYLES[0].bg }, { name: "Квартплата", bg: SERIES_STYLES[3].bg }]} />
      <ChartFrame axis={axis} maxMinor={Math.max(0, ...totals.filter((v): v is number => v !== null))} label={label}>
        {({ x, y }) => (
          <>
            {segments(rents, x, y).map((d) => <path key={`r${d}`} d={d} fill="none" strokeWidth={2} strokeDasharray="5 3" className={SERIES_STYLES[3].stroke} />)}
            {segments(totals, x, y).map((d) => <path key={`t${d}`} d={d} fill="none" strokeWidth={2} className={SERIES_STYLES[0].stroke} />)}
            {shares.map((s, index) => s ? (
              <g key={s.period}>
                <title>{`${shortMonth(s.period)}: итог ${formatMoney(s.totalMinor)}, квартплата ${formatMoney(s.rentMinor)}, коммуналка ${s.share === null ? "— (квартплата не указана)" : Math.round(s.share * 100) + "% от квартплаты"}`}</title>
                <circle cx={x(index) + SLOT / 2} cy={y(s.totalMinor)} r={3} className={SERIES_STYLES[0].fill} />
                <circle cx={x(index) + SLOT / 2} cy={y(s.rentMinor)} r={2.5} className={SERIES_STYLES[3].fill} />
              </g>
            ) : null)}
          </>
        )}
      </ChartFrame>
      <p className="mt-1 text-2xs text-muted-foreground">Коммуналка в среднем составляет <strong className="text-foreground">{avgShare === null ? "—" : `${Math.round(avgShare * 100)}%`}</strong> от квартплаты (месяцы без квартплаты не учитываются).</p>
      <Fallback summary="Таблица значений">
        <table className="w-full min-w-max">
          <thead className="text-muted-foreground"><tr><th className={th}>Месяц</th><th className={th}>Квартплата</th><th className={th}>Коммуналка</th><th className={th}>Итого</th><th className={th}>Доля коммуналки</th></tr></thead>
          <tbody>{shares.map((s, index) => (
            <tr key={axis[index].period} className="border-t border-border/60">
              <td className={td}>{shortMonth(axis[index].period)}</td>
              {s ? <><td className={`${td} text-right`}>{formatMoney(s.rentMinor)}</td><td className={`${td} text-right`}>{formatMoney(s.utilityMinor)}</td><td className={`${td} text-right font-semibold`}>{formatMoney(s.totalMinor)}</td><td className={`${td} text-right`}>{s.share === null ? "—" : `${Math.round(s.share * 100)}%`}</td></> : <td className={`${td} text-muted-foreground`} colSpan={4}>нет данных</td>}
            </tr>
          ))}</tbody>
        </table>
      </Fallback>
    </figure>
  );
}

function YearOverYearBlock({ axis }: { axis: AxisPoint[] }): React.ReactElement {
  const rows = useMemo(() => yearOverYear(axis), [axis]);
  const max = Math.max(1, ...rows.flatMap((r) => [r.utilityMinor, r.previousUtilityMinor]));
  return (
    <figure>
      <figcaption className="mb-1 text-label font-semibold">Тот же месяц год назад · коммуналка</figcaption>
      {rows.length === 0 ? <p className="text-2xs text-muted-foreground">Пока нет пар месяцев с интервалом в год: нужны данные за один и тот же месяц в двух годах.</p> : (
        <>
          <Legend items={[{ name: "Год назад", bg: "bg-muted-foreground/50" }, { name: "Этот год", bg: SERIES_STYLES[1].bg }]} />
          <ul className="space-y-2" aria-label={`Сравнение с прошлым годом, ${rows.length} мес.`}>
            {rows.map((row) => (
              <li key={row.period} className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-2 text-2xs">
                <span className="text-muted-foreground">{shortMonth(row.period)}</span>
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2"><div className="h-2 rounded-r bg-muted-foreground/50" style={{ width: `${(row.previousUtilityMinor / max) * 100}%` }} /><span className="shrink-0 tabular-nums text-muted-foreground">{formatMoney(row.previousUtilityMinor)}</span></div>
                  <div className="flex items-center gap-2"><div className="h-2 rounded-r bg-cyan-400" style={{ width: `${(row.utilityMinor / max) * 100}%` }} /><span className="shrink-0 tabular-nums">{formatMoney(row.utilityMinor)}</span><span className={`shrink-0 tabular-nums ${row.utilityDeltaMinor > 0 ? "text-warning" : "text-success"}`}>{signed(row.utilityDeltaMinor)} · {percent(row.utilityDeltaPercent)}</span></div>
                </div>
              </li>
            ))}
          </ul>
          <Fallback summary="Таблица значений">
            <table className="w-full min-w-max">
              <thead className="text-muted-foreground"><tr><th className={th}>Месяц</th><th className={th}>Год назад</th><th className={th}>Сейчас</th><th className={th}>Разница</th><th className={th}>Итог, разница</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.period} className="border-t border-border/60"><td className={td}>{shortMonth(r.period)}</td><td className={`${td} text-right`}>{formatMoney(r.previousUtilityMinor)}</td><td className={`${td} text-right`}>{formatMoney(r.utilityMinor)}</td><td className={`${td} text-right`}>{signed(r.utilityDeltaMinor)} ({percent(r.utilityDeltaPercent)})</td><td className={`${td} text-right`}>{signed(r.totalDeltaMinor)}</td></tr>)}</tbody>
            </table>
          </Fallback>
        </>
      )}
    </figure>
  );
}

function TariffBlock({ axis }: { axis: AxisPoint[] }): React.ReactElement {
  const impacts = useMemo(() => tariffImpacts(axis), [axis]);
  const values = axis.map((p) => (p.month ? p.month.utilityMinor : null));
  const visibleMarkers = impacts.map((i) => i.change).filter((c) => axis.some((p) => p.period === c.period));
  const label = `Коммуналка по месяцам с отметками смены тарифов: ${impacts.map((i) => `${i.change.label}, в среднем ${i.beforeAverageMinor === null ? "нет данных" : formatMoney(i.beforeAverageMinor)} до и ${i.afterAverageMinor === null ? "нет данных" : formatMoney(i.afterAverageMinor)} после`).join("; ")}.`;
  return (
    <figure>
      <figcaption className="mb-1 text-label font-semibold">Рост после смены тарифов</figcaption>
      <Legend items={[{ name: "Коммуналка за месяц", bg: SERIES_STYLES[1].bg }, { name: "Смена тарифа", bg: "bg-warning" }]} />
      <ChartFrame axis={axis} maxMinor={Math.max(0, ...values.filter((v): v is number => v !== null))} label={label} markers={visibleMarkers}>
        {({ x, y, bar }) => values.map((value, index) => value === null ? null : (
          <rect key={axis[index].period} x={x(index) + 4} y={y(value)} width={bar} height={Math.max(0.5, y(0) - y(value))} className={SERIES_STYLES[1].fill}><title>{`${shortMonth(axis[index].period)}: ${formatMoney(value)}`}</title></rect>
        ))}
      </ChartFrame>
      <div className="mt-3 grid gap-2 [@container(min-width:600px)]:grid-cols-2">
        {impacts.map((impact) => (
          <div key={impact.change.period} className="rounded-lg border border-border/70 p-3 text-2xs">
            <strong className="block text-label">{impact.change.label}</strong>
            <span className="text-muted-foreground">Среднее в месяц (коммуналка), месяцев до: {impact.beforePeriods.length}, после: {impact.afterPeriods.length}</span>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
              <dt className="text-muted-foreground">До</dt><dd>{impact.beforeAverageMinor === null ? "нет данных" : formatMoney(impact.beforeAverageMinor)}</dd>
              <dt className="text-muted-foreground">После</dt><dd>{impact.afterAverageMinor === null ? "нет данных" : formatMoney(impact.afterAverageMinor)}</dd>
              <dt className="text-muted-foreground">Рост</dt><dd className={impact.deltaMinor !== null && impact.deltaMinor > 0 ? "text-warning" : ""}>{impact.deltaMinor === null ? "—" : `${signed(impact.deltaMinor)} · ${percent(impact.deltaPercent)}`}</dd>
              <dt className="text-muted-foreground">Общий итог</dt><dd>{impact.beforeTotalAverageMinor === null ? "—" : formatMoney(impact.beforeTotalAverageMinor)} → {impact.afterTotalAverageMinor === null ? "—" : formatMoney(impact.afterTotalAverageMinor)}</dd>
            </dl>
          </div>
        ))}
      </div>
      <p className="mt-1 text-2xs text-subtle-foreground">Окна — до 6 месяцев с каждой стороны и не заходят за соседнюю смену. Месяц смены считается «после»; пропущенные месяцы не усредняются как нули. Рост может зависеть и от расхода, не только от тарифа.</p>
    </figure>
  );
}

function Reconciliation({ months }: { months: UtilityMonth[] }): React.ReactElement {
  const rows = useMemo(() => reconcile(months), [months]);
  return (
    <section aria-labelledby="util-reconcile">
      <h5 id="util-reconcile" className="mb-1 text-label font-semibold">Сверка с исходной таблицей</h5>
      {rows.length === 0 ? <p className="text-2xs text-muted-foreground">Расхождений между импортированными итогами и суммой строк компаний нет.</p> : (
        <>
          <p className="mb-2 text-2xs text-warning">Найдено месяцев с расхождением: {rows.length}. Разница = итог в исходной таблице минус сумма строк (с квартплатой). Положительная — в таблице больше, чем в строках.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-2xs">
              <thead className="text-muted-foreground"><tr><th className={th}>Месяц</th><th className={th}>Сумма строк</th><th className={th}>«Итоговая» в таблице</th><th className={th}>Разница итога</th><th className={th}>Разница «Итого»</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.period} className="border-t border-border/60">
                  <td className={td}>{shortMonth(r.period)}</td>
                  <td className={`${td} text-right`}>{formatMoney(r.grandTotalMinor)}</td>
                  <td className={`${td} text-right`}>{r.importedGrandTotalMinor === null ? "—" : formatMoney(r.importedGrandTotalMinor)}</td>
                  <td className={`${td} text-right ${r.grandDifferenceMinor ? "font-semibold text-warning" : ""}`}>{r.grandDifferenceMinor === null ? "—" : r.grandDifferenceMinor === 0 ? "совпадает" : signed(r.grandDifferenceMinor)}</td>
                  <td className={`${td} text-right ${r.utilityDifferenceMinor ? "font-semibold text-warning" : ""}`}>{r.utilityDifferenceMinor === null ? "—" : r.utilityDifferenceMinor === 0 ? "совпадает" : signed(r.utilityDifferenceMinor)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function UtilitiesAnalytics({ months }: { months: UtilityMonth[] }): React.ReactElement | null {
  const [range, setRange] = useState<6 | 12 | 0>(12);
  // Пустой черновик не должен искажать историю: ось строится только по месяцам с данными, дыры остаются дырами.
  const fullAxis = useMemo(() => monthAxis(months), [months]);
  const axis = useMemo(() => lastPoints(fullAxis, range), [fullAxis, range]);
  if (fullAxis.length === 0) return null;
  const known = fullAxis.filter((p) => p.month);
  const first = known[0].month!;
  const latest = known[known.length - 1].month!;
  const average = Math.round(known.reduce((sum, p) => sum + p.month!.grandTotalMinor, 0) / known.length);
  const highest = known.reduce((best, p) => (p.month!.grandTotalMinor > best.month!.grandTotalMinor ? p : best));
  const change = latest.grandTotalMinor - first.grandTotalMinor;
  const missing = fullAxis.length - known.length;
  return (
    <Card className="space-y-6 p-4 [@container(min-width:700px)]:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h4 className="text-title">Аналитика квартплаты</h4><p className="text-2xs text-muted-foreground">Начисления по внесённым месяцам, включая черновики. Месяцы без данных остаются пропусками{missing ? ` (сейчас ${missing})` : ""}, а не нулями.</p></div>
        <div className="flex rounded-lg border border-border p-1" role="group" aria-label="Период диаграмм">
          {([6, 12, 0] as const).map((value) => <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)} className={`rounded px-2.5 py-1 text-2xs ${range === value ? "bg-accent/20 text-accent" : "text-muted-foreground hover:bg-white/5"}`}>{value || "Все"}{value ? " мес." : ""}</button>)}
        </div>
      </div>
      <div className="grid gap-2 [@container(min-width:650px)]:grid-cols-3">
        <div className="rounded-lg border border-border/70 p-3"><span className="text-2xs text-muted-foreground">В среднем за месяц</span><strong className="mt-1 block text-lg tabular-nums">{formatMoney(average)}</strong></div>
        <div className="rounded-lg border border-border/70 p-3"><span className="text-2xs text-muted-foreground">Изменение с {shortMonth(first.period)}</span><strong className={`mt-1 block text-lg tabular-nums ${change > 0 ? "text-warning" : "text-success"}`}>{signed(change)}</strong></div>
        <div className="rounded-lg border border-border/70 p-3"><span className="text-2xs text-muted-foreground">Максимум · {shortMonth(highest.period)}</span><strong className="mt-1 block text-lg tabular-nums">{formatMoney(highest.month!.grandTotalMinor)}</strong></div>
      </div>
      <CompanyChart axis={axis} />
      <RentChart axis={axis} />
      <YearOverYearBlock axis={fullAxis} />
      <TariffBlock axis={fullAxis} />
      <Reconciliation months={months} />
    </Card>
  );
}

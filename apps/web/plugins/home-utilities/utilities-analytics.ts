import type { UtilityMonth } from "@orion/shared-types";

/**
 * Чистые расчёты аналитики коммуналки. Деньги — целые копейки.
 * Правило: неизвестный/пустой месяц — это пропуск (`null`), а не ноль.
 */

/** Месяц «с данными»: пустой черновик (ни квартплаты, ни начислений) в статистику не входит. */
export function hasData(month: UtilityMonth): boolean {
  return month.grandTotalMinor > 0;
}

export function periodIndex(period: string): number {
  const [year, month] = period.split("-").map(Number);
  return year * 12 + (month - 1);
}

export function indexToPeriod(index: number): string {
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Сплошная ось месяцев от первого до последнего месяца с данными; нет данных — `month: null`. */
export interface AxisPoint { period: string; month: UtilityMonth | null }

export function monthAxis(months: readonly UtilityMonth[]): AxisPoint[] {
  const known = new Map<string, UtilityMonth>();
  for (const month of months) if (hasData(month)) known.set(month.period, month);
  if (known.size === 0) return [];
  const indices = [...known.keys()].map(periodIndex);
  const from = Math.min(...indices);
  const to = Math.max(...indices);
  const axis: AxisPoint[] = [];
  for (let index = from; index <= to; index++) {
    const period = indexToPeriod(index);
    axis.push({ period, month: known.get(period) ?? null });
  }
  return axis;
}

/** Последние `count` точек оси (0 — все). */
export function lastPoints(axis: readonly AxisPoint[], count: number): AxisPoint[] {
  return count > 0 ? axis.slice(-count) : [...axis];
}

const companyKey = (name: string) => name.trim().toLowerCase();

export interface CompanySeries { key: string; name: string; totalMinor: number; values: (number | null)[] }

/**
 * Серии по компаниям для столбцов «стопкой». Значение — сумма строк компании за месяц;
 * если месяца нет — `null`; если месяц есть, а компании в нём нет, — `0` (компания в этом месяце ничего не начислила).
 * Компании упорядочены по сумме за весь период (крупные снизу стопки).
 */
export function companySeries(axis: readonly AxisPoint[]): CompanySeries[] {
  const map = new Map<string, CompanySeries>();
  axis.forEach((point, column) => {
    if (!point.month) return;
    for (const charge of point.month.charges) {
      const key = companyKey(charge.name);
      let series = map.get(key);
      if (!series) {
        series = { key, name: charge.name.trim(), totalMinor: 0, values: axis.map((p) => (p.month ? 0 : null)) };
        map.set(key, series);
      }
      series.values[column] = (series.values[column] ?? 0) + charge.amountMinor;
      series.totalMinor += charge.amountMinor;
    }
  });
  return [...map.values()].sort((a, b) => b.totalMinor - a.totalMinor || a.name.localeCompare(b.name, "ru"));
}

export interface RentShare { period: string; totalMinor: number; rentMinor: number; utilityMinor: number; share: number | null }

/** Доля коммуналки от квартплаты: utility / rent. Нет квартплаты (0) — доля неизвестна (`null`). */
export function rentShares(axis: readonly AxisPoint[]): (RentShare | null)[] {
  return axis.map(({ period, month }) => month ? {
    period, totalMinor: month.grandTotalMinor, rentMinor: month.rentMinor, utilityMinor: month.utilityMinor,
    share: month.rentMinor > 0 ? month.utilityMinor / month.rentMinor : null
  } : null);
}

export interface YearOverYear {
  period: string;
  previousPeriod: string;
  totalMinor: number;
  previousTotalMinor: number;
  utilityMinor: number;
  previousUtilityMinor: number;
  /** Разница коммуналки, копейки. Сравниваем именно коммуналку: квартплата — отдельный договор. */
  utilityDeltaMinor: number;
  utilityDeltaPercent: number | null;
  totalDeltaMinor: number;
}

/** Тот же месяц год назад: пара есть, только если оба месяца с данными. */
export function yearOverYear(axis: readonly AxisPoint[]): YearOverYear[] {
  const byPeriod = new Map<string, UtilityMonth>();
  for (const { period, month } of axis) if (month) byPeriod.set(period, month);
  const rows: YearOverYear[] = [];
  for (const [period, month] of byPeriod) {
    const previousPeriod = indexToPeriod(periodIndex(period) - 12);
    const previous = byPeriod.get(previousPeriod);
    if (!previous) continue;
    rows.push({
      period, previousPeriod,
      totalMinor: month.grandTotalMinor, previousTotalMinor: previous.grandTotalMinor,
      utilityMinor: month.utilityMinor, previousUtilityMinor: previous.utilityMinor,
      utilityDeltaMinor: month.utilityMinor - previous.utilityMinor,
      utilityDeltaPercent: previous.utilityMinor > 0 ? (month.utilityMinor - previous.utilityMinor) / previous.utilityMinor : null,
      totalDeltaMinor: month.grandTotalMinor - previous.grandTotalMinor
    });
  }
  return rows.sort((a, b) => a.period.localeCompare(b.period));
}

export interface TariffChange { period: string; label: string }

/** Известные смены тарифов; редактируются здесь, не в разметке. */
export const TARIFF_CHANGES: readonly TariffChange[] = [
  { period: "2025-07", label: "Тарифы июля 2025" },
  { period: "2025-12", label: "Тарифы декабря 2025" }
];

export interface TariffImpact {
  change: TariffChange;
  beforePeriods: string[];
  afterPeriods: string[];
  /** Средняя коммуналка в месяц до/после (по месяцам с данными); `null` — данных нет. */
  beforeAverageMinor: number | null;
  afterAverageMinor: number | null;
  deltaMinor: number | null;
  deltaPercent: number | null;
  /** Средний общий итог (квартплата + коммуналка) в месяц до/после. */
  beforeTotalAverageMinor: number | null;
  afterTotalAverageMinor: number | null;
}

/**
 * Среднее до и после смены тарифа. Окно — до `window` месяцев с каждой стороны, но не заходит
 * за соседнюю смену, чтобы эффекты двух повышений не смешивались. Месяц смены входит в «после».
 * Считается средняя КОММУНАЛКА (квартплата тарифами не меняется). Пропуски не усредняются как нули.
 */
export function tariffImpacts(axis: readonly AxisPoint[], changes: readonly TariffChange[] = TARIFF_CHANGES, window = 6): TariffImpact[] {
  const byPeriod = new Map<string, UtilityMonth>();
  for (const { period, month } of axis) if (month) byPeriod.set(period, month);
  const sorted = [...changes].sort((a, b) => a.period.localeCompare(b.period));
  return sorted.map((change, i) => {
    const at = periodIndex(change.period);
    const prev = i > 0 ? periodIndex(sorted[i - 1].period) : -Infinity;
    const next = i < sorted.length - 1 ? periodIndex(sorted[i + 1].period) : Infinity;
    const collect = (from: number, to: number) => {
      const periods: string[] = [];
      for (let index = from; index <= to; index++) {
        const period = indexToPeriod(index);
        if (byPeriod.has(period)) periods.push(period);
      }
      return periods;
    };
    const beforePeriods = collect(Math.max(prev, at - window), at - 1);
    const afterPeriods = collect(at, Math.min(next - 1, at + window - 1));
    const avg = (periods: string[], field: "utilityMinor" | "grandTotalMinor" = "utilityMinor") => periods.length
      ? Math.round(periods.reduce((sum, period) => sum + byPeriod.get(period)![field], 0) / periods.length)
      : null;
    const beforeAverageMinor = avg(beforePeriods);
    const afterAverageMinor = avg(afterPeriods);
    const deltaMinor = beforeAverageMinor !== null && afterAverageMinor !== null ? afterAverageMinor - beforeAverageMinor : null;
    return {
      change, beforePeriods, afterPeriods, beforeAverageMinor, afterAverageMinor, deltaMinor,
      beforeTotalAverageMinor: avg(beforePeriods, "grandTotalMinor"), afterTotalAverageMinor: avg(afterPeriods, "grandTotalMinor"),
      deltaPercent: deltaMinor !== null && beforeAverageMinor ? deltaMinor / beforeAverageMinor : null
    };
  });
}

export interface Discrepancy {
  period: string;
  /** «Итого» из исходной таблицы минус сумма строк компаний; `null` — в таблице не было. */
  utilityDifferenceMinor: number | null;
  /** «Итоговая» из исходной таблицы минус (квартплата + сумма строк компаний). */
  grandDifferenceMinor: number | null;
  importedUtilityMinor: number | null;
  importedGrandTotalMinor: number | null;
  utilityMinor: number;
  grandTotalMinor: number;
}

/** Месяцы, где импортированные итоги не равны сумме строк. Различия находятся по данным, не зашиты в код. */
export function reconcile(months: readonly UtilityMonth[]): Discrepancy[] {
  const rows: Discrepancy[] = [];
  for (const month of months) {
    const utilityDifferenceMinor = month.importedUtilityMinor === null ? null : month.importedUtilityMinor - month.utilityMinor;
    const grandDifferenceMinor = month.importedGrandTotalMinor === null ? null : month.importedGrandTotalMinor - month.grandTotalMinor;
    if (!utilityDifferenceMinor && !grandDifferenceMinor) continue;
    rows.push({
      period: month.period, utilityDifferenceMinor, grandDifferenceMinor,
      importedUtilityMinor: month.importedUtilityMinor, importedGrandTotalMinor: month.importedGrandTotalMinor,
      utilityMinor: month.utilityMinor, grandTotalMinor: month.grandTotalMinor
    });
  }
  return rows.sort((a, b) => a.period.localeCompare(b.period));
}

/** Палитра по порядку компаний; хвост сверх лимита сворачивается в «Прочие». */
export function foldCompanies(series: readonly CompanySeries[], limit: number): CompanySeries[] {
  if (series.length <= limit) return [...series];
  const head = series.slice(0, limit - 1);
  const tail = series.slice(limit - 1);
  const values = tail[0].values.map((_, column) => {
    const parts = tail.map((s) => s.values[column]);
    return parts.every((v) => v === null) ? null : parts.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  });
  return [...head, { key: "__other__", name: "Прочие", totalMinor: tail.reduce((s, t) => s + t.totalMinor, 0), values }];
}

// Будущая зона прогноза: перевод DTO снимка или реконструкции в точки для графика
// и сверка прогноза с фактом после «Показать будущее». Чистые функции — тестируются без DOM.

import type { Candle, ForecastBarriers, ForecastCoreResponse, ForecastDto, ForecastEvaluate, ForecastReconstruction, ForecastScenario } from "./types";
import { TF_MS } from "./indicators";

export interface ZonePoint {
  t: number;
  value: number;
}

export interface ZonePath {
  id: ForecastScenario["id"];
  label: string;
  points: ZonePoint[];
}

export interface FutureZone {
  /** Ключ фокуса графика: смена ключа — перевести вид на новую зону. */
  key: string;
  originTs: number;
  basePrice: number;
  horizon: number;
  tf: string;
  hideFuture: boolean;
  source: "snapshot" | "reconstruction" | "preview";
  maeMedianPct: number | null;
  mfeMedianPct: number | null;
  breakoutPct: number | null;
  breakdownPct: number | null;
  insidePct: number | null;
  rangeStatus: string | null;
  barriers: ForecastBarriers | null;
  uid?: string;
  /** Время снимка, мс: API отдаёт created_at в секундах — переводим на входе зоны. */
  createdAt?: number;
  paths: ZonePath[];
  bands: { p5: ZonePoint[]; p10: ZonePoint[]; p25: ZonePoint[]; p75: ZonePoint[]; p90: ZonePoint[]; p95: ZonePoint[] };
  scenarios: ForecastScenario[];
  regime: ForecastCoreResponse["regime"];
  calibrationNote: string;
  analogues: { chosen: number; candidates: number; span: { from_ts: number; to_ts: number } };
  warnings: string[];
  stale: boolean;
  /** Реконструкция: сколько свечей после момента уже есть в ряду. */
  barsAfter?: number;
  /** Отпечаток видимого окна — доказательство происхождения чисел. */
  dataHash: string;
}

export interface ZoneComparisonStep {
  t: number;
  k: number;
  actual: number;
  p5: number | null;
  p25: number | null;
  p75: number | null;
  p95: number | null;
  inside90: boolean;
  inside50: boolean;
}

function tfMs(tf: string): number {
  return TF_MS[tf] ?? TF_MS["1d"];
}

function bandsFromSteps(core: ForecastCoreResponse, originTs: number): FutureZone["bands"] {
  const step = tfMs(core.tf);
  const p5: ZonePoint[] = [];
  const p10: ZonePoint[] = [];
  const p25: ZonePoint[] = [];
  const p75: ZonePoint[] = [];
  const p90: ZonePoint[] = [];
  const p95: ZonePoint[] = [];
  for (const s of core.distribution.steps) {
    const t = originTs + s.step * step;
    p5.push({ t, value: s.p5 });
    p10.push({ t, value: s.p10 });
    p25.push({ t, value: s.p25 });
    p75.push({ t, value: s.p75 });
    p90.push({ t, value: s.p90 });
    p95.push({ t, value: s.p95 });
  }
  return { p5, p10, p25, p75, p90, p95 };
}

function pathsFromScenarios(core: ForecastCoreResponse, originTs: number): ZonePath[] {
  const step = tfMs(core.tf);
  return core.scenarios
    .filter((s) => !s.empty_group)
    .map((s) => ({
      id: s.id,
      label: s.id === "base" ? `${s.label} · горизонт ${core.horizon}` : s.label,
      points: s.median_path.map((value, m) => ({ t: originTs + m * step, value })),
    }));
}

function baseZone(core: ForecastCoreResponse, originTs: number): Omit<FutureZone, "key" | "hideFuture" | "source"> {
  return {
    originTs,
    basePrice: core.base_price,
    horizon: core.horizon,
    tf: core.tf,
    paths: pathsFromScenarios(core, originTs),
    bands: bandsFromSteps(core, originTs),
    scenarios: core.scenarios,
    regime: core.regime,
    calibrationNote: core.calibration.note,
    analogues: {
      chosen: core.analogues.chosen,
      candidates: core.analogues.candidates,
      span: core.analogues.span,
    },
    warnings: core.warnings,
    stale: core.data_info.stale,
    dataHash: core.data_hash,
    maeMedianPct: core.distribution.mae_median_pct,
    mfeMedianPct: core.distribution.mfe_median_pct,
    breakoutPct: core.distribution.range?.breakout_pct ?? null,
    breakdownPct: core.distribution.range?.breakdown_pct ?? null,
    insidePct: core.distribution.range?.inside_pct ?? null,
    rangeStatus: core.distribution.range?.status ?? null,
    barriers: core.barriers ?? core.distribution.barriers ?? null,
  };
}

/** Снимок: зона от его последней свечи. Свечи правее сначала скрыты — их открывает «Показать будущее». */
export function zoneFromDto(dto: ForecastDto): FutureZone {
  const base = baseZone(dto, dto.last_ts);
  return {
    ...base,
    key: `s:${dto.uid}:${dto.last_ts}:${dto.horizon}`,
    hideFuture: true,
    source: "snapshot",
    uid: dto.uid,
    createdAt: dto.created_at * 1000,
  };
}

/** Реконструкция: видны только свечи по момент; будущее сначала скрыто. */
export function zoneFromReconstruction(res: ForecastReconstruction): FutureZone {
  const originTs = res.reconstruction.origin_ts;
  const base = baseZone(res, originTs);
  return {
    ...base,
    key: `r:${res.reconstruction.at_ts}:${originTs}:${res.horizon}`,
    hideFuture: true,
    source: "reconstruction",
    barsAfter: res.reconstruction.bars_after,
  };
}

/** Предпросмотр текущего края: в базу не пишется, прятать будущее нечего. */
export function zoneFromPreview(core: ForecastCoreResponse): FutureZone {
  const base = baseZone(core, core.last_ts);
  return {
    ...base,
    key: `p:${core.last_ts}:${core.horizon}:${core.data_hash.slice(0, 8)}`,
    hideFuture: false,
    source: "preview",
  };
}

/** Ряд для графика: в режиме Reveal Future свечи после момента прогноза скрыты. */
export function visibleChartCandles(candles: Candle[], zone: FutureZone | null): Candle[] {
  if (!zone?.hideFuture) return candles;
  return candles.filter((c) => c.t <= zone.originTs);
}

/** Полоса распределения на шаге k (1..horizon); null — шага нет в распределении. */
export function bandAt(zone: FutureZone, k: number): Omit<ZoneComparisonStep, "t" | "actual" | "inside90" | "inside50"> | null {
  const i = k - 1;
  if (i < 0 || i >= zone.bands.p5.length) return null;
  return {
    k,
    p5: zone.bands.p5[i]?.value ?? null,
    p25: zone.bands.p25[i]?.value ?? null,
    p75: zone.bands.p75[i]?.value ?? null,
    p95: zone.bands.p95[i]?.value ?? null,
  };
}

/** Сверка прогноза с фактом: по каждому шагу, где уже есть настоящая свеча. */
export function zoneComparison(zone: FutureZone, candles: Candle[]): ZoneComparisonStep[] {
  const step = tfMs(zone.tf);
  const byT = new Map(candles.map((c) => [c.t, c]));
  const out: ZoneComparisonStep[] = [];
  for (let k = 1; k <= zone.horizon; k++) {
    const t = zone.originTs + k * step;
    const c = byT.get(t);
    if (!c) break;
    const band = bandAt(zone, k);
    if (!band) break;
    const { p5, p25, p75, p95 } = band;
    out.push({
      t,
      k,
      actual: c.c,
      p5,
      p25,
      p75,
      p95,
      inside90: p5 !== null && p95 !== null && c.c >= p5 && c.c <= p95,
      inside50: p25 !== null && p75 !== null && c.c >= p25 && c.c <= p75,
    });
  }
  return out;
}

export const VERDICT_LABEL: Record<ForecastEvaluate["verdict"], string> = {
  good: "надёжен",
  limited: "ограничен",
  poor: "слаб",
  insufficient_data: "данных мало",
};

/** Короткая сводка walk-forward для панели: что измерено и каков вердикт. */
export function evalSummary(e: ForecastEvaluate): string {
  const parts = [`Вердикт: ${VERDICT_LABEL[e.verdict]}`];
  if (e.points.scored) {
    parts.push(`точек оценено ${e.points.scored} (шаг ${e.points.step})`);
  }
  if (e.skill_pct !== null) {
    parts.push(`преимущество над базовой моделью ${e.skill_pct > 0 ? "+" : ""}${e.skill_pct}%`);
  }
  const cover = e.coverage["90"]?.actual_pct;
  if (cover !== null && cover !== undefined) {
    parts.push(`покрытие 90%-й полосы ${cover}%`);
  }
  return parts.join(" · ");
}

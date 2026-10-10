import type { Candle, Signal } from "./types";

export type ZoneOutcome = "live" | "target" | "stop";

/** Зона актуального сигнала на графике: вход, стоп и цель, и чем всё закончилось по свечам после сигнала. */
export interface ZoneModel {
  key: string;
  t0: number; // свеча сигнала, мс
  entry: number;
  stop: number | null;
  target: number | null;
  long: boolean;
  rr: number | null; // выигрыш к риску
  riskPct: number | null; // до стопа, % от входа (со знаком: убыток отрицателен)
  rewardPct: number | null; // до цели, %
  outcome: ZoneOutcome;
  endT: number | null; // свеча, на которой сработали стоп или цель
}

/**
 * Модель зоны для записанного сигнала на вход. Если на одной свече задеты и стоп, и цель,
 * считаем, что первым сработал стоп: порядок внутри свечи неизвестен, и этот вариант осторожнее.
 */
export function signalZone(s: Signal | null | undefined, candles: Candle[]): ZoneModel | null {
  if (!s || s.side !== "buy" || s.status === "dismissed") return null;
  if (s.stop == null && s.target == null) return null;
  const entry = s.open_px ?? s.price;
  const long = s.direction ? s.direction === "long" : s.stop != null ? s.stop < entry : (s.target as number) > entry;
  const pct = (level: number | null) => (level == null || entry === 0 ? null : ((level - entry) / entry) * 100 * (long ? 1 : -1));
  const risk = s.stop != null ? Math.abs(entry - s.stop) : null;
  const reward = s.target != null ? Math.abs(s.target - entry) : null;

  let outcome: ZoneOutcome = "live";
  let endT: number | null = null;
  for (const c of candles) {
    if (c.t <= s.candle_ts) continue;
    const stopHit = s.stop != null && (long ? c.l <= s.stop : c.h >= s.stop);
    const targetHit = s.target != null && (long ? c.h >= s.target : c.l <= s.target);
    if (stopHit || targetHit) {
      outcome = stopHit ? "stop" : "target";
      endT = c.t;
      break;
    }
  }
  return {
    key: String(s.id),
    t0: s.candle_ts,
    entry,
    stop: s.stop,
    target: s.target,
    long,
    rr: risk && reward ? reward / risk : null,
    riskPct: pct(s.stop),
    rewardPct: pct(s.target),
    outcome,
    endT,
  };
}

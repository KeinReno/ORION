import type { Candle } from "./types";

export interface DayRefs {
  /** Закрытие предыдущих суток (для дневного графика — предыдущей свечи). */
  prevClose: number | null;
  /** Максимум и минимум текущих суток; для дневного графика не считаются. */
  dayHigh: number | null;
  dayLow: number | null;
}

/** Опорные цены последних суток: вчерашнее закрытие и экстремумы сегодняшнего дня. */
export function dayRefs(candles: Candle[], dayKey: (t: number) => string, daily: boolean): DayRefs {
  const none: DayRefs = { prevClose: null, dayHigh: null, dayLow: null };
  if (candles.length === 0) return none;
  if (daily) return { ...none, prevClose: candles.length > 1 ? candles[candles.length - 2].c : null };
  const key = dayKey(candles[candles.length - 1].t);
  let i = candles.length - 1;
  let hi = -Infinity;
  let lo = Infinity;
  while (i >= 0 && dayKey(candles[i].t) === key) {
    hi = Math.max(hi, candles[i].h);
    lo = Math.min(lo, candles[i].l);
    i--;
  }
  return { prevClose: i >= 0 ? candles[i].c : null, dayHigh: hi, dayLow: lo };
}

export type SessionKind = "morning" | "main" | "evening";

/** Сессия акций МосБиржи по московскому времени свечи: утренняя 06:50–09:50, основная до 18:50, вечерняя с 19:05. */
export function moexSession(minutesOfDay: number): SessionKind {
  if (minutesOfDay < 9 * 60 + 50) return "morning";
  if (minutesOfDay < 18 * 60 + 50) return "main";
  return "evening";
}

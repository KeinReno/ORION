/** Простая скользящая средняя для оверлея на графике. Прогрев (n-1 первых точек) пропускается. */
export function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** Экспоненциальная средняя. Затравка — простая средняя первых n значений, до неё null. */
export function ema(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = 0;
  for (let i = 0; i < n; i++) prev += values[i];
  prev /= n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Полосы Боллинджера: средняя n и отклонение ±k·σ (по генеральной выборке, как в большинстве терминалов). */
export function bollinger(values: number[], n = 20, k = 2) {
  const mid = sma(values, n);
  const up: (number | null)[] = new Array(values.length).fill(null);
  const low: (number | null)[] = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    const m = mid[i] as number;
    let sq = 0;
    for (let j = i - n + 1; j <= i; j++) sq += (values[j] - m) ** 2;
    const sd = Math.sqrt(sq / n);
    up[i] = m + k * sd;
    low[i] = m - k * sd;
  }
  return { mid, up, low };
}

/** RSI по Уайлдеру. Первое значение — на индексе n. */
export function rsi(values: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  const val = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[n] = val();
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = val();
  }
  return out;
}

/** MACD: быстрая и медленная EMA, сигнальная линия и гистограмма. */
export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line: (number | null)[] = values.map((_, i) => (f[i] == null || s[i] == null ? null : (f[i] as number) - (s[i] as number)));
  const firstIdx = line.findIndex((v) => v != null);
  const sig: (number | null)[] = new Array(values.length).fill(null);
  if (firstIdx >= 0) {
    const tail = ema(line.slice(firstIdx) as number[], signal);
    tail.forEach((v, i) => (sig[firstIdx + i] = v));
  }
  const hist = line.map((v, i) => (v == null || sig[i] == null ? null : v - (sig[i] as number)));
  return { line, signal: sig, hist };
}

interface Ohlc { o: number; h: number; l: number; c: number }

/** ATR по Уайлдеру (в единицах цены). */
export function atr(rows: Ohlc[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(rows.length).fill(null);
  if (rows.length <= n) return out;
  const tr = rows.map((x, i) =>
    i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - rows[i - 1].c), Math.abs(x.l - rows[i - 1].c)),
  );
  let prev = 0;
  for (let i = 1; i <= n; i++) prev += tr[i];
  prev /= n;
  out[n] = prev;
  for (let i = n + 1; i < rows.length; i++) {
    prev = (prev * (n - 1) + tr[i]) / n;
    out[i] = prev;
  }
  return out;
}

/** VWAP со сбросом в начале каждой сессии (dayKey даёт ключ суток). Без объёма значение null. */
export function vwap(rows: (Ohlc & { v: number; t: number })[], dayKey: (t: number) => string): (number | null)[] {
  let day = "";
  let pv = 0;
  let vol = 0;
  return rows.map((x) => {
    const k = dayKey(x.t);
    if (k !== day) {
      day = k;
      pv = 0;
      vol = 0;
    }
    pv += ((x.h + x.l + x.c) / 3) * x.v;
    vol += x.v;
    return vol > 0 ? pv / vol : null;
  });
}

/** Свечи Heikin-Ashi: сглаженный вид тренда. Время и объём сохраняются. */
export function heikinAshi<T extends Ohlc>(rows: T[]): T[] {
  const out: T[] = [];
  rows.forEach((x, i) => {
    const c = (x.o + x.h + x.l + x.c) / 4;
    const o = i === 0 ? (x.o + x.c) / 2 : (out[i - 1].o + out[i - 1].c) / 2;
    out.push({ ...x, o, c, h: Math.max(x.h, o, c), l: Math.min(x.l, o, c) });
  });
  return out;
}

/** Время свечи (мс), в которую попадает момент ts; null — раньше первой свечи или позже последней. */
export function snapToCandle(times: number[], ts: number, tfMs: number): number | null {
  if (times.length === 0 || ts < times[0]) return null;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= ts) lo = mid;
    else hi = mid - 1;
  }
  return ts < times[lo] + tfMs ? times[lo] : null;
}

export const TF_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "10m": 600_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

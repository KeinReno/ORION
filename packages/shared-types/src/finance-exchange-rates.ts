import { z } from "zod";

/**
 * Plugin `finance-exchange-rates`: exchange rates ENTERED BY HAND, one per currency pair per day. ORION has no external
 * rate source on purpose (it works offline and a silent third-party rate would make totals untraceable): every
 * converted figure can be explained by a rate the user typed and a date.
 *
 * `rateMicro` is "how many `quote` per ONE `base`", times 1 000 000 — an integer, like money. 92,5 ₽ per $ is 92 500 000.
 * Only a direct rate or its inverse is used; there is no triangulation through a third currency, because a rate nobody
 * entered is a guess.
 */
export const RATE_SCALE = 1_000_000;
export const MAX_RATE_MICRO = 2_000_000_000;

const currencyCode = z.string().regex(/^[A-Z]{3}$/, "Код валюты — три латинские буквы");

export const exchangeRateSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  base: z.string(),
  quote: z.string(),
  rateMicro: z.number().int().positive(),
  /** "YYYY-MM-DD" — the day the rate is valid from. */
  day: z.string(),
  createdAt: z.string()
});
export type ExchangeRate = z.infer<typeof exchangeRateSchema>;

export const upsertExchangeRateInputSchema = z
  .object({
    base: currencyCode,
    quote: currencyCode,
    rateMicro: z.number().int().positive("Курс должен быть больше нуля").max(MAX_RATE_MICRO),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД")
  })
  .refine((value) => value.base !== value.quote, { message: "Валюты должны различаться", path: ["quote"] });
export type UpsertExchangeRateInput = z.infer<typeof upsertExchangeRateInputSchema>;

/** "92,5" / "92.50" → 92 500 000; null for anything that is not a positive number within range. */
export function parseRate(text: string): number | null {
  const normalized = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) return null;
  const micro = Math.round(Number(normalized) * RATE_SCALE);
  return micro > 0 && micro <= MAX_RATE_MICRO ? micro : null;
}

/** 92 500 000 → "92,5" (trailing zeros dropped). */
export function formatRate(rateMicro: number): string {
  const text = (rateMicro / RATE_SCALE).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return text.replace(".", ",");
}

/** Whole `base` units → `quote`, in minor units: round(amount × rate). Float math is exact enough below 2^53 kopecks. */
export function convertMinor(amountMinor: number, rateMicro: number): number {
  return Math.round(amountMinor * (rateMicro / RATE_SCALE));
}

export interface RateLookup {
  /**
   * The rate exactly as it was entered. For a direct lookup it is `to` per one `from`; when `inverse` is true it is the
   * reverse pair as typed (`from` per one `to`) — it is kept unrounded-by-inversion on purpose, see `convertWithRate`.
   */
  rateMicro: number;
  /** The rate that was used, so the screen can say «по курсу от …». */
  day: string;
  inverse: boolean;
}

/**
 * `amountMinor` of `from` → `to`, minor units. An inverse rate DIVIDES by the entered rate instead of multiplying by its
 * reciprocal: the reciprocal of 95 is 0,010526…, and a micro-unit integer would lose the digits that matter.
 */
export function convertWithRate(amountMinor: number, lookup: RateLookup): number {
  const rate = lookup.rateMicro / RATE_SCALE;
  return Math.round(lookup.inverse ? amountMinor / rate : amountMinor * rate);
}

/**
 * The rate to turn `from` into `to` on `onDay` ("YYYY-MM-DD"): the newest direct rate valid on or before that day, else
 * the inverse of the newest `to→from` rate. A direct rate wins when both exist for the same day.
 */
export function findRate(rates: readonly Pick<ExchangeRate, "base" | "quote" | "rateMicro" | "day">[], from: string, to: string, onDay: string): RateLookup | null {
  if (from === to) return { rateMicro: RATE_SCALE, day: onDay, inverse: false };
  const newest = (base: string, quote: string) =>
    rates
      .filter((rate) => rate.base === base && rate.quote === quote && rate.day <= onDay)
      .sort((a, b) => b.day.localeCompare(a.day))[0];
  const direct = newest(from, to);
  const reverse = newest(to, from);
  if (direct && (!reverse || direct.day >= reverse.day)) return { rateMicro: direct.rateMicro, day: direct.day, inverse: false };
  if (reverse) return { rateMicro: reverse.rateMicro, day: reverse.day, inverse: true };
  return null;
}

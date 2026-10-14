import { electricityTariffInputSchema } from "@orion/shared-types";

/**
 * Разбор ручного ввода калькулятора электричества. `Number()` слишком мягок для форм:
 * принимает «0x10», «1e3», «Infinity» и тихо превращает их в числа. Здесь — только обычная десятичная запись.
 */
const DECIMAL = /^\d{1,12}([.,]\d{1,6})?$/;
const WHOLE = /^\d{1,4}$/;

/** «1 250,5» → 1250.5; всё остальное — NaN. */
export function parseDecimalInput(value: string): number {
  const text = value.trim().replace(/\s/g, "");
  return DECIMAL.test(text) ? Number(text.replace(",", ".")) : NaN;
}

export function parseWholeInput(value: string): number {
  const text = value.trim();
  return WHOLE.test(text) ? Number(text) : NaN;
}

/** Рубли → копейки; null для пустого/неверного ввода. */
export function parseRubToMinor(value: string): number | null {
  const text = value.trim().replace(/\s/g, "").replace(",", ".");
  return /^\d{1,8}(\.\d{1,2})?$/.test(text) ? Math.round(Number(text) * 100) : null;
}

export type RateInput = { kind: "empty" } | { kind: "invalid" } | { kind: "ok"; rateRub: string };

/** Тариф, введённый вручную: пусто, неверно (раньше молча игнорировалось) либо корректная строка для расчёта. */
export function parseRateInput(value: string): RateInput {
  const text = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!text) return { kind: "empty" };
  return electricityTariffInputSchema.shape.rateRub.safeParse(text).success ? { kind: "ok", rateRub: text } : { kind: "invalid" };
}

/** Можно ли записать новое показание: оно не меньше предыдущего. Тариф для записи не нужен. */
export function canRecordReading(previous: number | null, value: string): boolean {
  const next = parseDecimalInput(value);
  return previous !== null && Number.isFinite(next) && next >= previous;
}

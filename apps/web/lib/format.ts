/**
 * Small date/label helpers shared by the panels. Kept in one place so
 * "2 часа назад" reads identically on the dashboard, in Notes and in Tasks.
 */

const RU_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60]
];

const rtf = new Intl.RelativeTimeFormat("ru-RU", { numeric: "auto" });

/** "2 часа назад", "через 3 дня", "только что". */
export function relativeTime(iso: string): string {
  const diffSeconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 45) return "только что";
  for (const [unit, seconds] of RU_UNITS) {
    if (abs >= seconds) return rtf.format(Math.round(diffSeconds / seconds), unit);
  }
  return rtf.format(Math.round(diffSeconds / 60), "minute");
}

/** Calendar day from `YYYY-MM-DD` (or a Date ISO) without UTC-shift: "19 сентября 2026". */
export function formatDayTitle(ymd: string): string {
  const datePart = ymd.slice(0, 10);
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) return datePart;
  return new Date(year, month - 1, day).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

/** Short absolute stamp: "6 сен, 14:30". */
export function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** Short calendar day without time: "25 сен". */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/**
 * Where an event starts on the viewer's own calendar. An all-day event's
 * `startAt` is a date, not an instant (UTC midnight — see shared-types
 * event.ts), so it is re-anchored on local midnight of that date; reading
 * it as an instant shows "03:00" in Moscow and the previous day west of UTC.
 */
export function eventLocalStart(event: { startAt: string; allDay: boolean }): Date {
  const d = new Date(event.startAt);
  return event.allDay ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : d;
}

/** "3 окт." for an all-day event, "3 окт., 14:30" for a timed one. */
export function eventShortStart(event: { startAt: string; allDay: boolean }): string {
  const start = eventLocalStart(event).toISOString();
  return event.allDay ? shortDate(start) : shortDateTime(start);
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export type DueBucket = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

export function dueBucket(iso: string | null, done = false): DueBucket {
  if (!iso) return "none";
  const due = new Date(iso);
  const now = new Date();
  if (!done && due.getTime() < now.getTime()) return "overdue";
  if (isSameDay(due, now)) return "today";
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (isSameDay(due, tomorrow)) return "tomorrow";
  const weekAhead = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  if (due.getTime() <= weekAhead.getTime()) return "week";
  return "later";
}

export const DUE_BUCKET_LABEL: Record<DueBucket, string> = {
  overdue: "Просрочено",
  today: "Сегодня",
  tomorrow: "Завтра",
  week: "На этой неделе",
  later: "Позже",
  none: "Без срока"
};

/** Stable HSL-ish colour for a free-form project tag — matches the calendar pills. */
export function projectColor(tag: string): { color: string; background: string; borderColor: string } {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return {
    color: `hsl(${hue} 80% 78%)`,
    background: `hsl(${hue} 70% 60% / 0.16)`,
    borderColor: `hsl(${hue} 70% 60% / 0.35)`
  };
}

/** For a datetime-local input: local wall-clock value of an ISO string. */
export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

/**
 * ORION v0.8 "Финансы" money helpers. Amounts cross the API boundary as an
 * Int in kopecks (see docs/PLAN.md) — same reasoning as dates being ISO
 * strings: no float rounding, no ambiguity. These two functions are the
 * only place that boundary is crossed on the frontend.
 */

const money = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Trailing symbol per ISO code for the currencies the account form offers; anything else prints the code itself. */
const CURRENCY_SYMBOL: Record<string, string> = { RUB: "₽", USD: "$", EUR: "€", KZT: "₸", BYN: "Br" };

/**
 * 12345 (kopecks) → "123,45 ₽". Amounts stay integers in kopecks (see plan —
 * same reasoning as ISO dates). `currency` only picks the trailing symbol
 * and defaults to ₽ for pre-v0.14 call sites — there is still no conversion
 * anywhere. NOTE: accounts are *not* all one currency per workspace since
 * v0.14 (`Account.currency`, set per account) — never sum amounts from more
 * than one account into a single `formatMoney(...)` call without first
 * grouping by currency (`sumByCurrency` below); that produces a number that
 * looks precise but isn't a real amount of anything.
 */
export function formatMoney(kopecks: number, currency = "RUB"): string {
  return `${money.format(kopecks / 100)} ${CURRENCY_SYMBOL[currency] ?? currency}`;
}

/**
 * Sums `amount` per distinct `currency` instead of into one combined number
 * — the only correct way to total money across a set of items that may not
 * share a currency (accounts, and anything derived from them). 100 USD + 100
 * EUR is not 200 of anything, so a naive `reduce((sum, x) => sum + amount(x),
 * 0)` across mixed currencies is a bug, not a simplification (see S16 in
 * docs/SONNET_IMPLEMENTATION/12-PROGRESS.md — this is exactly what
 * DashboardPanel's finance card did before). Order follows first-seen
 * currency, which is stable enough for a UI list; callers with exactly one
 * entry get the pre-v0.14 single-currency behaviour back for free.
 */
export function sumByCurrency<T>(
  items: readonly T[],
  currency: (item: T) => string,
  amount: (item: T) => number
): [string, number][] {
  const totals = new Map<string, number>();
  for (const item of items) {
    const c = currency(item);
    totals.set(c, (totals.get(c) ?? 0) + amount(item));
  }
  return [...totals.entries()];
}

/** Rubles-with-kopecks input string ("1234,56" or "-12.5") → integer kopecks, any sign/zero, or null if not a parseable number. */
export function parseMoneyInput(input: string): number | null {
  const normalized = input.trim().replace(",", ".");
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Same as parseMoneyInput, but rejects zero/negative — for transaction and budget amounts, which are always a positive magnitude (the sign comes from `type`, not the value). */
export function toKopecks(input: string): number | null {
  const value = parseMoneyInput(input);
  return value !== null && value > 0 ? value : null;
}

/** Integer kopecks → a plain rubles-with-kopecks string for an editable form field ("1234.56"), "" for 0/undefined. */
export function fromKopecks(kopecks: number | undefined): string {
  if (!kopecks) return "";
  return (kopecks / 100).toString();
}

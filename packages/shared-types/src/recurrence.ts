/**
 * ORION v0.10 "Календарь" — a deliberately small recurrence engine, written
 * by hand instead of pulling in `rrule` (see docs/HISTORY.md v0.10: the four
 * rules below cover a solo dev's real needs, and staying dependency-free
 * keeps this testable as pure logic in `pnpm test`, like the zod schemas).
 *
 * All arithmetic is on UTC components — the same choice `advance()` in
 * finance/recurring made, and for the same reason: no host-timezone drift
 * between the API process and the cron. The known cost is that a *timed*
 * recurring event does not self-correct across a DST transition (a 09:00
 * event becomes 08:00 or 10:00 wall-clock on the other side). All-day
 * events use date-only math and are immune. `Event.tz` is stored so a
 * future version can do proper zone-aware expansion without a migration.
 */

export type RecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly";

export interface RecurrenceSpec {
  freq: RecurrenceFreq;
  /** Every N periods. >= 1. */
  interval: number;
  /**
   * `weekly` only: which weekdays fire, 0 = Monday .. 6 = Sunday. Empty or
   * absent means "the same weekday as the start", i.e. a plain weekly rule.
   */
  byWeekday?: number[];
  /** Inclusive ISO upper bound on the occurrence start, or null for none. Mutually exclusive with `count`. */
  until: string | null;
  /** Total number of occurrences including the first, or null for unbounded. Mutually exclusive with `until`. */
  count: number | null;
}

/** Hard stop so a malformed spec can never spin forever. ~10 years of a daily rule. */
const MAX_ITERATIONS = 4000;

const DAY_MS = 24 * 60 * 60 * 1000;

function addUtcDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

/** Monday 00:00 UTC of the week containing `d`, keeping `d`'s clock time. */
function mondayOf(d: Date): Date {
  const weekday = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return addUtcDays(d, -weekday);
}

/** A UTC date at (year, month, day) clamped to the month's length, carrying `base`'s time-of-day. */
function ymdWithTime(base: Date, year: number, month: number, day: number): Date {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(day, daysInMonth),
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds()
    )
  );
}

/**
 * Lazily yields occurrence start dates in chronological order, starting at
 * `dtStart` itself. Never terminates on its own — the caller bounds it by
 * window, `until` and `count`.
 */
function* iterate(spec: RecurrenceSpec, dtStart: Date): Generator<Date> {
  const interval = Math.max(1, Math.floor(spec.interval));

  if (spec.freq === "daily") {
    for (let k = 0; ; k++) yield addUtcDays(dtStart, k * interval);
  }

  if (spec.freq === "weekly") {
    const startWeekday = (dtStart.getUTCDay() + 6) % 7;
    const weekdays = (spec.byWeekday && spec.byWeekday.length > 0 ? [...spec.byWeekday] : [startWeekday])
      .filter((w) => w >= 0 && w <= 6)
      .sort((a, b) => a - b);
    const anchor = mondayOf(dtStart);
    for (let w = 0; ; w++) {
      const weekStart = addUtcDays(anchor, w * interval * 7);
      for (const wd of weekdays) {
        const occ = addUtcDays(weekStart, wd);
        // The first partial week can produce days before dtStart — skip them
        // so the series always begins exactly at dtStart.
        if (occ.getTime() >= dtStart.getTime()) yield occ;
      }
    }
  }

  if (spec.freq === "monthly") {
    for (let k = 0; ; k++) {
      const total = dtStart.getUTCMonth() + k * interval;
      const year = dtStart.getUTCFullYear() + Math.floor(total / 12);
      const month = ((total % 12) + 12) % 12;
      yield ymdWithTime(dtStart, year, month, dtStart.getUTCDate());
    }
  }

  // yearly
  for (let k = 0; ; k++) {
    yield ymdWithTime(dtStart, dtStart.getUTCFullYear() + k * interval, dtStart.getUTCMonth(), dtStart.getUTCDate());
  }
}

/**
 * Every occurrence start of `spec` (anchored at `dtStart`) that lands in the
 * half-open window `[windowStart, windowEnd)`. `count` and `until` are
 * measured from the series start, not the window — an out-of-window
 * occurrence still consumes the `count` budget, matching iCalendar.
 */
export function expandRecurrence(
  spec: RecurrenceSpec,
  dtStart: Date,
  windowStart: Date,
  windowEnd: Date
): Date[] {
  const out: Date[] = [];
  const untilMs = spec.until ? new Date(spec.until).getTime() : Infinity;
  const maxCount = spec.count ?? Infinity;
  const windowEndMs = windowEnd.getTime();
  const windowStartMs = windowStart.getTime();

  let emitted = 0;
  let iterations = 0;
  for (const occ of iterate(spec, dtStart)) {
    if (++iterations > MAX_ITERATIONS) break;
    const t = occ.getTime();
    if (t > untilMs) break;
    if (emitted >= maxCount) break;
    emitted++;
    if (t >= windowEndMs) break;
    if (t >= windowStartMs) out.push(occ);
  }
  return out;
}

const WEEKDAY_RU = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const WEEKDAY_RU_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/** Human-readable RU summary for the event form / detail sheet ("каждые 2 недели по пн, ср"). */
export function describeRecurrence(spec: RecurrenceSpec): string {
  const n = Math.max(1, Math.floor(spec.interval));
  let base: string;
  if (spec.freq === "daily") base = n === 1 ? "ежедневно" : `каждые ${n} дн.`;
  else if (spec.freq === "weekly") {
    base = n === 1 ? "еженедельно" : `каждые ${n} нед.`;
    if (spec.byWeekday && spec.byWeekday.length > 0) {
      const days = [...spec.byWeekday].sort((a, b) => a - b).map((w) => WEEKDAY_RU_SHORT[w]);
      base += ` по ${days.join(", ")}`;
    }
  } else if (spec.freq === "monthly") base = n === 1 ? "ежемесячно" : `каждые ${n} мес.`;
  else base = n === 1 ? "ежегодно" : `каждые ${n} г.`;

  if (spec.count) return `${base}, ${spec.count} раз`;
  if (spec.until) {
    return `${base}, до ${new Date(spec.until).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}`;
  }
  return base;
}

const RRULE_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** `YYYYMMDDTHHMMSSZ` — the only date form iCalendar UNTIL accepts. */
function toICalUtc(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
}

/**
 * The spec as an RFC 5545 RRULE line value (no `RRULE:` prefix), for the
 * outbound .ics feed. Every spec this engine accepts is expressible, so
 * this never returns null today — the signature keeps the door open.
 */
export function recurrenceToRRule(spec: RecurrenceSpec): string {
  const freq = spec.freq.toUpperCase();
  const parts = [`FREQ=${freq}`, `INTERVAL=${Math.max(1, Math.floor(spec.interval))}`];
  if (spec.freq === "weekly" && spec.byWeekday && spec.byWeekday.length > 0) {
    parts.push(`BYDAY=${[...spec.byWeekday].sort((a, b) => a - b).map((w) => RRULE_DAYS[w]).join(",")}`);
  }
  if (spec.count) parts.push(`COUNT=${spec.count}`);
  else if (spec.until) parts.push(`UNTIL=${toICalUtc(new Date(spec.until))}`);
  return parts.join(";");
}

export { WEEKDAY_RU, WEEKDAY_RU_SHORT };

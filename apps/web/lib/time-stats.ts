import { entryMinutes, type TimeEntry } from "@orion/shared-types";

/**
 * Numbers behind the time charts. Framework-free (time-stats.test.ts).
 *
 * Days are LOCAL calendar days: an evening session belongs to the evening of the
 * person who worked it, not to tomorrow in UTC. A session that crosses midnight is
 * split between the two days it touched, so no day is credited with work it did not see.
 */

const MIN_MS = 60_000;

type Interval = Pick<TimeEntry, "startedAt" | "endedAt">;

export interface DayTotal {
  /** Local midnight of the day. */
  day: Date;
  /** `YYYY-MM-DD` (local) — a stable key. */
  key: string;
  minutes: number;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function localDayKey(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Minutes of `entry` that fall inside [from, to) — the overlap, so a running entry counts up to `now`. */
function overlapMinutes(entry: Interval, from: Date, to: Date, now: Date): number {
  const start = new Date(entry.startedAt).getTime();
  const end = entry.endedAt ? new Date(entry.endedAt).getTime() : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const lo = Math.max(start, from.getTime());
  const hi = Math.min(end, to.getTime());
  return hi > lo ? Math.round((hi - lo) / MIN_MS) : 0;
}

/** The last `days` local days ending today (oldest first), with the minutes worked on each. */
export function dailyTotals(entries: readonly Interval[], days: number, now: Date = new Date()): DayTotal[] {
  const today = startOfLocalDay(now);
  const out: DayTotal[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    let minutes = 0;
    for (const entry of entries) minutes += overlapMinutes(entry, day, next, now);
    out.push({ day, key: localDayKey(day), minutes });
  }
  return out;
}

export interface ShareItem {
  /** null = time with no project. */
  projectId: string | null;
  minutes: number;
  /** 0–100, of the total; rounded, so the list may sum to 99–101 — the bar uses `minutes`. */
  percent: number;
}

/**
 * How the period's time splits across projects, largest first. Only time that fell
 * inside the window counts (same overlap rule as the daily totals).
 */
export function projectShares(entries: readonly (Interval & Pick<TimeEntry, "projectId">)[], days: number, now: Date = new Date()): ShareItem[] {
  const today = startOfLocalDay(now);
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const byProject = new Map<string | null, number>();
  for (const entry of entries) {
    const minutes = overlapMinutes(entry, from, to, now);
    if (minutes <= 0) continue;
    byProject.set(entry.projectId, (byProject.get(entry.projectId) ?? 0) + minutes);
  }
  const total = [...byProject.values()].reduce((sum, m) => sum + m, 0);
  return [...byProject.entries()]
    .map(([projectId, minutes]) => ({ projectId, minutes, percent: total === 0 ? 0 : Math.round((minutes / total) * 100) }))
    .sort((a, b) => b.minutes - a.minutes);
}

export interface PeriodStats {
  total: number;
  /** Average over days that had any work — a quiet week should not look like a lazy one. */
  averageWorked: number;
  workedDays: number;
  best: DayTotal | null;
}

export function periodStats(totals: readonly DayTotal[]): PeriodStats {
  const worked = totals.filter((d) => d.minutes > 0);
  const total = totals.reduce((sum, d) => sum + d.minutes, 0);
  const best = worked.reduce<DayTotal | null>((top, d) => (top === null || d.minutes > top.minutes ? d : top), null);
  return { total, averageWorked: worked.length === 0 ? 0 : Math.round(total / worked.length), workedDays: worked.length, best };
}

/** Re-exported so charts and tests share one definition of "minutes of an entry". */
export { entryMinutes };

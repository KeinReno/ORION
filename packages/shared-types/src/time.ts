import { z } from "zod";

/**
 * ORION v0.18 «Учёт времени» — see docs/HISTORY.md.
 *
 * One entry is a stretch of work: `startedAt` plus `endedAt`, where a null
 * `endedAt` means the timer is running *right now*. Duration is never stored —
 * it is derived on both sides through `entryMinutes` below, so a running timer
 * needs no writes while it ticks.
 */

export const timeEntrySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  /**
   * The actor who worked this stretch. `null` means "unknown author" — a
   * legacy row created before S06 introduced this column, NOT "nobody's".
   * Never auto-attributed to the workspace owner; see the migration note in
   * `apps/api/prisma/migrations/*_time_entries_actor/migration.sql`.
   */
  userId: z.string().nullable(),
  /** True when `userId` is the caller's own id — what "мои" filters key on. */
  mine: z.boolean(),
  /** Optional: time can be tracked against a project without a specific task. */
  taskId: z.string().nullable(),
  /** Denormalised from the task when it isn't given explicitly (the panel sums by project). */
  projectId: z.string().nullable(),
  note: z.string(),
  startedAt: z.string(),
  /** Null = running. */
  endedAt: z.string().nullable(),
  /** Minutes worked as of the response: for a running entry, up to "now" (what the client then ticks on its own). */
  minutes: z.number().int(),
  running: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type TimeEntry = z.infer<typeof timeEntrySchema>;

/**
 * A cursor page of entries, newest first. `nextCursor` is the last row's id
 * to pass back as `cursor` for the next page, or `null` when there is no
 * more. See `TimeSummary` for exact totals — the point of the split is that
 * `items` can legitimately be a small window while `minutes`/`count` still
 * describe the whole matching set (S15).
 */
export const timeEntryPageSchema = z.object({
  items: z.array(timeEntrySchema),
  nextCursor: z.string().nullable()
});
export type TimeEntryPage = z.infer<typeof timeEntryPageSchema>;

/**
 * Server-computed totals for a filter set — a real SQL aggregation, not a
 * sum over whatever page the client happens to have loaded (S15: the panel
 * used to silently undercount past the old 500-row list cap).
 */
export const timeSummarySchema = z.object({
  minutes: z.number().int(),
  count: z.number().int()
});
export type TimeSummary = z.infer<typeof timeSummarySchema>;

/**
 * Buckets `entryMinutes` sums into "мои" / "команда" / "автор неизвестен"
 * instead of one flat total — a legacy row without a known author must never
 * be silently folded into either a person's or "everyone else's" total (see
 * S06: unknown-rate is `null` not `0`, same discipline here for authorship).
 */
export interface TimeAuthorshipTotals {
  mineMinutes: number;
  teamMinutes: number;
  unknownAuthorMinutes: number;
}

export function summarizeByAuthorship(entries: readonly TimeEntry[]): TimeAuthorshipTotals {
  let mineMinutes = 0;
  let teamMinutes = 0;
  let unknownAuthorMinutes = 0;
  for (const entry of entries) {
    if (entry.userId === null) unknownAuthorMinutes += entry.minutes;
    else if (entry.mine) mineMinutes += entry.minutes;
    else teamMinutes += entry.minutes;
  }
  return { mineMinutes, teamMinutes, unknownAuthorMinutes };
}

/** Something with a start and an optional end — enough to measure, without requiring a full DTO. */
export interface MeasurableInterval {
  startedAt: string;
  endedAt: string | null;
}

/**
 * Minutes between `startedAt` and `endedAt` (or `now` while running), rounded
 * to whole minutes and never negative. The API uses it for the DTO's `minutes`
 * and the client re-runs it every second for the live timer — one definition of
 * "how long", so the running value can't disagree with the stored one.
 */
export function entryMinutes(entry: MeasurableInterval, now: Date = new Date()): number {
  const start = new Date(entry.startedAt).getTime();
  const end = entry.endedAt ? new Date(entry.endedAt).getTime() : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60_000));
}

/** "2 ч 05 мин" / "45 мин" — the one place time is rendered as text, shared by every panel. */
export function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0) return `${rest} мин`;
  if (rest === 0) return `${hours} ч`;
  return `${hours} ч ${String(rest).padStart(2, "0")} мин`;
}

/** `YYYY-MM-DD` of an ISO instant — the grouping key for "по дням". */
export function timeEntryDay(entry: MeasurableInterval, timeZone: string | null = null): string {
  void timeZone; // Grouping is by UTC day; a per-user zone would need the whole panel to agree on one.
  return entry.startedAt.slice(0, 10);
}

/**
 * Cost of a stretch of work: `minutes` at `hourlyRateMinor` (kopecks per hour,
 * the unit `Project.hourlyRate` uses), rounded to whole kopecks.
 *
 * Returns `null` when the rate is unknown (`null`/`undefined`) — deliberately
 * not 0. "We don't know the rate" and "the rate is zero" are different claims,
 * and a total that silently adds zeros would understate the real figure while
 * looking authoritative. Callers sum only the non-null parts and say so.
 */
export function timeCostMinor(minutes: number, hourlyRateMinor: number | null | undefined): number | null {
  if (hourlyRateMinor === null || hourlyRateMinor === undefined) return null;
  return Math.round((Math.max(0, minutes) / 60) * hourlyRateMinor);
}

export const startTimerInputSchema = z.object({
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  note: z.string().max(2_000).default("")
});
export type StartTimerInput = z.infer<typeof startTimerInputSchema>;

export const stopTimerInputSchema = z.object({
  /** ISO instant to stop at; omitted = now. Lets the UI "stop at" a rounded time. */
  at: z.string().datetime().nullable().optional()
});
export type StopTimerInput = z.infer<typeof stopTimerInputSchema>;

export const createTimeEntryInputSchema = z.object({
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  note: z.string().max(2_000).default(""),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime()
});
export type CreateTimeEntryInput = z.infer<typeof createTimeEntryInputSchema>;

/**
 * A PATCH is partial, so the "end after start" rule is checked in
 * `TimeService` against the record merged with the input — a standalone schema
 * only ever sees half of the picture (same reasoning as `assertTransactionShape`
 * for finance, see finance-refs.util.ts).
 */
export const updateTimeEntryInputSchema = z.object({
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  note: z.string().max(2_000).optional(),
  startedAt: z.string().datetime().optional(),
  /** `null` restarts the entry (used by "продолжить"), and the DB allows only one running row per workspace. */
  endedAt: z.string().datetime().nullable().optional()
});
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntryInputSchema>;

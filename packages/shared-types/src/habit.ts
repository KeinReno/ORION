import { z } from "zod";

/**
 * ORION v0.19 «Привычки» — see docs/HISTORY.md.
 *
 * A habit is a weekly intention plus a set of ticks, one per calendar day. The
 * interesting logic — "is it scheduled today?" and "how long is the current
 * streak?" — lives here as pure functions, because the API computes a habit's
 * streak for the DTO and the panel shows it (and would otherwise have to
 * re-derive it differently).
 */

/** 0 = Monday … 6 = Sunday — deliberately the same convention as `recurrence.ts`'s `byWeekday`. */
export const habitWeekdaySchema = z.number().int().min(0).max(6);

/** Day keys are `YYYY-MM-DD` UTC days — the shape `HabitEntry.day` (`@db.Date`) round-trips. */
export const habitDayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ожидается дата вида ГГГГ-ММ-ДД");

export const habitSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  note: z.string(),
  /** Empty = every day. */
  weekdays: z.array(habitWeekdaySchema),
  color: z.string().nullable(),
  /** Non-null = archived (hidden from the daily checklist, ticks kept). */
  archivedAt: z.string().nullable(),
  /** Consecutive *scheduled* days with a tick, ending today or yesterday (see `habitStreak`). */
  streak: z.number().int(),
  /** Scheduled for the day the API considers "today". */
  dueToday: z.boolean(),
  doneToday: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Habit = z.infer<typeof habitSchema>;

export const createHabitInputSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(120),
  note: z.string().max(2_000).default(""),
  weekdays: z.array(habitWeekdaySchema).max(7).default([]),
  color: z.string().max(40).nullable().optional()
});
export type CreateHabitInput = z.infer<typeof createHabitInputSchema>;

export const updateHabitInputSchema = createHabitInputSchema.partial().extend({
  archivedAt: z.string().datetime().nullable().optional()
});
export type UpdateHabitInput = z.infer<typeof updateHabitInputSchema>;

export const habitEntrySchema = z.object({
  id: z.string(),
  habitId: z.string(),
  day: z.string(),
  createdAt: z.string()
});
export type HabitEntry = z.infer<typeof habitEntrySchema>;

/**
 * Toggling without a `day` uses the server's UTC day. The client passes its own
 * local day explicitly, so a tick made at 00:30 local time doesn't land on the
 * previous day just because the server sits in another timezone.
 */
export const toggleHabitInputSchema = z.object({ day: habitDayKeySchema.optional() });
export type ToggleHabitInput = z.infer<typeof toggleHabitInputSchema>;

export const toggleHabitResultSchema = z.object({
  habitId: z.string(),
  day: z.string(),
  done: z.boolean()
});
export type ToggleHabitResult = z.infer<typeof toggleHabitResultSchema>;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` from a Date's UTC components. */
export function habitDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/**
 * `YYYY-MM-DD` of the *user's own* calendar day, from the local components of
 * `date` (defaults to now).
 *
 * This is what the panel must send when ticking: the API has no idea which
 * timezone the user is in, so its default (`habitDayKey`, the server's UTC day)
 * would file a tick made at 00:30 local time under yesterday for anyone east of
 * UTC. The two helpers are deliberately separate rather than one clever one —
 * "the day it is for me" and "the day the server thinks it is" are different
 * questions, and only the client can answer the first.
 */
export function habitLocalDayKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The inverse: a `YYYY-MM-DD` key as UTC midnight, which is what `@db.Date` stores and returns. */
export function habitDayDate(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

/** 0 = Monday … 6 = Sunday for a day key (JS `getUTCDay` is 0 = Sunday, hence the shift). */
export function habitWeekdayOf(dayKey: string): number {
  return (habitDayDate(dayKey).getUTCDay() + 6) % 7;
}

/** A habit with no weekdays is an every-day habit, not a never-day one. */
export function isHabitScheduled(weekdays: number[], dayKey: string): boolean {
  return weekdays.length === 0 || weekdays.includes(habitWeekdayOf(dayKey));
}

/**
 * Length of the current streak: consecutive *scheduled* days that carry a tick,
 * counted backwards from `todayKey`. Days the habit isn't scheduled for are
 * skipped without breaking it (a Mon/Wed/Fri habit done Mon and Wed has a
 * streak of 2, not 1).
 *
 * Today is forgiving on purpose: if it's scheduled and not ticked yet, the
 * streak still counts what came before — the day isn't over, so it hasn't been
 * broken. That is the behaviour every habit tracker has, and the alternative
 * ("streak reads 0 until you tick today") makes the number useless in the
 * morning.
 */
export function habitStreak(weekdays: number[], doneDays: Iterable<string>, todayKey: string): number {
  const done = doneDays instanceof Set ? doneDays : new Set(doneDays);
  const cursor = habitDayDate(todayKey);

  if (isHabitScheduled(weekdays, habitDayKey(cursor)) && !done.has(habitDayKey(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let streak = 0;
  // Bounded so a habit with a broken schedule can never spin forever.
  for (let guard = 0; guard < 3_660; guard++) {
    if (!isHabitScheduled(weekdays, habitDayKey(cursor))) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      continue;
    }
    if (!done.has(habitDayKey(cursor))) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

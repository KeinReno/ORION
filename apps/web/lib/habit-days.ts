import { habitLocalDayKey, habitWeekdayOf, type Habit, type HabitEntry } from "@orion/shared-types";
import { PALETTE_SWATCHES } from "@orion/ui";

/**
 * Pure helpers behind the habits panel: the visible week, the tick lookup and
 * the Russian labels. They live outside the component for the same reason
 * `panels/time/summary.ts` does — the panel is layout, this is the arithmetic.
 *
 * Every day key here is the **user's** calendar day (`habitLocalDayKey`), not
 * the server's UTC day: the API computes `dueToday`/`streak`/`doneToday` against
 * its own day, which is a different question the moment the user is not on UTC.
 */

/** Пн…Вс — the index is the `habitWeekdaySchema` value (0 = Monday). */
export const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

/** Weekday names for tooltips and accessible labels — never shown as a column header (that's `WEEKDAY_SHORT`). */
const WEEKDAY_TITLE = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"] as const;

export interface WeekDay {
  /** `YYYY-MM-DD` of the user's calendar day. */
  key: string;
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  /** Day of the month, for the column header. */
  dayOfMonth: number;
  isToday: boolean;
}

/** The seven days of the week containing `now`, Monday first — the grid's columns. */
export function buildWeek(now: Date): WeekDay[] {
  const todayKey = habitLocalDayKey(now);
  // `habitWeekdayOf` reads the key as a UTC day, which is exactly the label the
  // key carries; the offset is then applied to the *local* date.
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - habitWeekdayOf(todayKey));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    const key = habitLocalDayKey(date);
    return { key, weekday: index, dayOfMonth: date.getDate(), isToday: key === todayKey };
  });
}

/**
 * `weeks` chronological weeks (oldest first) ending with the week containing
 * `now` — the columns of the activity heatmap. Each entry is a full Mon..Sun
 * `WeekDay[]` from `buildWeek`, so the heatmap and the weekly grid above it
 * share the exact same day-key arithmetic (local days, Monday-first).
 */
export function buildHeatmapWeeks(now: Date, weeks: number): WeekDay[][] {
  const result: WeekDay[][] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    result.push(buildWeek(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7)));
  }
  return result;
}

/** `habitId → set of ticked days` — one pass over the tick list, for the grid and the daily checkbox. */
export function entryDaysByHabit(entries: HabitEntry[] | undefined): Map<string, Set<string>> {
  const byHabit = new Map<string, Set<string>>();
  for (const entry of entries ?? []) {
    const days = byHabit.get(entry.habitId) ?? new Set<string>();
    days.add(entry.day);
    byHabit.set(entry.habitId, days);
  }
  return byHabit;
}

/**
 * "Due today" for the panel is now simply the server's flag: the panel sends
 * its own calendar day as `?today=` (see `useHabits`), so the answer is already
 * about the user's day. Kept as a named helper because the call sites read
 * better than a bare `.dueToday`, and because it documents *why* there is no
 * client-side schedule check here any more.
 */
export function isDueToday(habit: Habit): boolean {
  return habit.dueToday;
}

/** "каждый день" or "Пн, Ср, Пт" — never an empty string, an empty schedule has a meaning. */
export function scheduleLabel(weekdays: number[]): string {
  if (weekdays.length === 0) return "каждый день";
  return [...weekdays]
    .sort((a, b) => a - b)
    .map((weekday) => WEEKDAY_SHORT[weekday] ?? WEEKDAY_TITLE[weekday])
    .join(", ");
}

export function weekdayTitle(weekday: number): string {
  return WEEKDAY_TITLE[weekday] ?? "";
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = Math.abs(count) % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function pluralDays(count: number): string {
  return plural(count, "день", "дня", "дней");
}

export function pluralHabits(count: number): string {
  return plural(count, "привычка", "привычки", "привычек");
}

/** "5 дней подряд" — the streak badge's accessible/tooltip text. */
export function streakLabel(streak: number): string {
  return `${streak} ${pluralDays(streak)} подряд`;
}

/** Palette key → fill, for the dot next to a habit's name. */
export function habitSwatchColor(key: string | null | undefined): string | undefined {
  return key ? PALETTE_SWATCHES.find((swatch) => swatch.key === key)?.color : undefined;
}

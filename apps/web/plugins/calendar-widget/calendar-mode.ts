/**
 * How much of the sidebar mini-calendar to draw. The choice is pure so a short
 * container cannot be overruled by a saved "show more" preference.
 */

export type CalendarMode = "full" | "week" | "minimal";

/** Month grid. The container must be at least this tall. */
export const CALENDAR_FULL_MIN_PX = 240;
/** Current week. From this height up to {@link CALENDAR_FULL_MIN_PX}. */
export const CALENDAR_WEEK_MIN_PX = 120;

const RANK: Record<CalendarMode, number> = { minimal: 0, week: 1, full: 2 };

function modeForHeight(heightPx: number): CalendarMode {
  if (heightPx >= CALENDAR_FULL_MIN_PX) return "full";
  if (heightPx >= CALENDAR_WEEK_MIN_PX) return "week";
  return "minimal";
}

/**
 * `heightPx` is the height the widget may occupy. `saved` may only step down
 * from that: a stored "full" still becomes "week" or "minimal" when the box is shorter.
 * `null` means no stored preference.
 */
export function pickCalendarMode(heightPx: number, saved: CalendarMode | null): CalendarMode {
  const fitted = modeForHeight(heightPx);
  if (saved == null) return fitted;
  return RANK[saved] < RANK[fitted] ? saved : fitted;
}

/** About 30% of the sidebar. Applied as max-height on the widget root. */
export function calendarCapPx(sidebarHeightPx: number): number {
  if (!(sidebarHeightPx > 0)) return 0;
  return sidebarHeightPx * 0.3;
}

/**
 * Reads a stored preference. New values are `full` | `week` | `minimal`.
 * The old collapsed flag (`"1"` / `"0"`) still counts: collapsed forces minimal,
 * expanded does not force a size.
 */
export function parseSavedCalendarMode(mode: string | null, legacyCollapsed?: string | null): CalendarMode | null {
  if (mode === "full" || mode === "week" || mode === "minimal") return mode;
  if (legacyCollapsed === "1") return "minimal";
  return null;
}

/**
 * What a drag/keyboard reschedule of a calendar EVENT actually sends to the
 * API. Framework-free on purpose (unit-tested in calendar-reschedule.test.ts).
 *
 * The grids report a drop in three shapes (`ReschedulePayload` from @orion/ui):
 *  - time grid, hour area — `{ start, end }` real instants: pass through;
 *  - time grid, «весь день» band — `{ start, end, allDay: true }` where
 *    `start` is the target day as a UTC-midnight date (`allDayDateISO`);
 *  - month grid — `{ start }` only, local noon of the target day.
 *
 * The month-grid shape used to be sent as-is: the server stored the raw noon
 * instant as `startAt` of an all-day event (breaking its date-only contract)
 * and kept the old `endAt` — for a timed event the new start could land
 * after its own end, and its time of day was replaced by 12:00. Here the
 * event keeps its length and (for timed events) its local time of day; only
 * the date changes.
 */

const DAY_MS = 86_400_000;

export interface ReschedulableEvent {
  startAt: string;
  endAt: string;
  allDay: boolean;
}

export interface RescheduleDrop {
  start: string;
  end?: string;
  allDay?: boolean;
}

export interface EventReschedulePatch {
  startAt: string;
  endAt: string;
  allDay: boolean;
}

/** UTC-midnight ISO of a LOCAL calendar day (the all-day storage contract). */
function utcDateOfLocalDay(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** UTC-midnight of the UTC date an ISO instant falls on. */
function utcDateOf(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole days an all-day event spans (exclusive end), at least one. */
function allDaySpan(event: ReschedulableEvent): number {
  const days = Math.round((utcDateOf(event.endAt) - utcDateOf(event.startAt)) / DAY_MS);
  return Math.max(1, days);
}

export function eventReschedulePatch(event: ReschedulableEvent, drop: RescheduleDrop): EventReschedulePatch {
  if (drop.allDay) {
    // «Весь день» band: the target day is already a UTC-midnight date. A
    // multi-day all-day event keeps its span; a timed one becomes one day.
    const start = utcDateOf(drop.start);
    const span = event.allDay ? allDaySpan(event) : 1;
    return { startAt: new Date(start).toISOString(), endAt: new Date(start + span * DAY_MS).toISOString(), allDay: true };
  }

  if (drop.end === undefined) {
    // Month grid: only the target day is known (local noon of it).
    const target = new Date(drop.start);
    if (event.allDay) {
      const start = utcDateOfLocalDay(target);
      return {
        startAt: new Date(start).toISOString(),
        endAt: new Date(start + allDaySpan(event) * DAY_MS).toISOString(),
        allDay: true
      };
    }
    const oldStart = new Date(event.startAt);
    const duration = new Date(event.endAt).getTime() - oldStart.getTime();
    const start = new Date(
      target.getFullYear(),
      target.getMonth(),
      target.getDate(),
      oldStart.getHours(),
      oldStart.getMinutes(),
      oldStart.getSeconds(),
      oldStart.getMilliseconds()
    );
    return { startAt: start.toISOString(), endAt: new Date(start.getTime() + duration).toISOString(), allDay: false };
  }

  return { startAt: drop.start, endAt: drop.end, allDay: drop.allDay ?? event.allDay };
}

/**
 * Keyboard shift (Shift+←/→/↑/↓) of an all-day item: whole UTC days, never
 * `setDate` on the local clock — a DST switch would otherwise move the
 * UTC-midnight anchor to 23:00/01:00 and the server's UTC-date snap could
 * land it on the neighbouring day.
 */
export function shiftAllDayIso(iso: string, days: number): string {
  return new Date(utcDateOf(iso) + days * DAY_MS).toISOString();
}

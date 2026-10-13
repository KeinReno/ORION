/**
 * The month grid of the sidebar calendar widget (Widget Surface, Э2). Local-time days,
 * weeks start on Monday. Pure functions so the widget only draws what is computed here.
 */

export interface MiniMonthCell {
  /** Local day key `YYYY-MM-DD`. */
  key: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
}

export function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Always 6 rows × 7 columns, so the widget does not change height from month to month. */
export function buildMiniMonth(year: number, month: number, today: Date): MiniMonthCell[] {
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const todayKey = localDayKey(today);
  const cells: MiniMonthCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(year, month, 1 - mondayOffset + index);
    const key = localDayKey(date);
    cells.push({ key, day: date.getDate(), inMonth: date.getMonth() === month, isToday: key === todayKey });
  }
  return cells;
}

/** The ISO window the widget fetches: from the first visible cell to the day after the last. */
export function miniMonthRange(cells: MiniMonthCell[]): { from: string; to: string } {
  const [y1, m1, d1] = cells[0].key.split("-").map(Number);
  const [y2, m2, d2] = cells[cells.length - 1].key.split("-").map(Number);
  return { from: new Date(y1, m1 - 1, d1).toISOString(), to: new Date(y2, m2 - 1, d2 + 1).toISOString() };
}

export interface DayMarks {
  events: number;
  tasks: number;
}

/** Counts of events (by start) and open tasks (by due date) per local day. */
export function markDays(
  events: ReadonlyArray<{ startAt: string }>,
  tasks: ReadonlyArray<{ dueAt: string | null; closed: boolean }>
): Map<string, DayMarks> {
  const marks = new Map<string, DayMarks>();
  const bump = (iso: string, field: keyof DayMarks): void => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return;
    const key = localDayKey(date);
    const current = marks.get(key) ?? { events: 0, tasks: 0 };
    current[field] += 1;
    marks.set(key, current);
  };
  for (const event of events) bump(event.startAt, "events");
  for (const task of tasks) if (task.dueAt && !task.closed) bump(task.dueAt, "tasks");
  return marks;
}

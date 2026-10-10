import type { Milestone, Task } from "@orion/shared-types";
import { groupTasksByMilestone } from "./project-focus";

/**
 * Placement rules for the project plan's timeline and roadmap views. Framework-free
 * (tested in project-plan.test.ts): the components only draw what this decides.
 *
 * Dates are placed by LOCAL calendar day — a deadline "on the 20th" sits in the 20th's
 * column wherever the person is, never shifted by the UTC offset.
 */

const DAY_MS = 86_400_000;

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Whole calendar days from `from`'s day to `date`'s day (negative = before). */
export function dayOffset(date: Date, from: Date): number {
  return Math.round((startOfLocalDay(date).getTime() - startOfLocalDay(from).getTime()) / DAY_MS);
}

export interface TimelineRange {
  /** Local midnight of the first column. */
  start: Date;
  days: number;
}

/**
 * The visible time axis: every dated item and today, with a little air before and a
 * longer runway after (the future is what a plan is for), and never narrower than
 * `minDays` so a one-deadline project still reads as a timeline.
 */
export function timelineRange(dates: readonly Date[], now: Date = new Date(), minDays = 28): TimelineRange {
  const points = [...dates, now].map((d) => startOfLocalDay(d).getTime());
  const first = Math.min(...points) - 3 * DAY_MS;
  const last = Math.max(...points) + 7 * DAY_MS;
  const start = new Date(first);
  const days = Math.max(minDays, Math.round((last - first) / DAY_MS) + 1);
  return { start: new Date(start.getFullYear(), start.getMonth(), start.getDate()), days };
}

const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export interface WeekTick {
  /** Day offset from the range start. */
  offset: number;
  label: string;
}

/** A tick on every Monday inside the range ("6 окт"), the unit people actually plan in. */
export function weekTicks(range: TimelineRange): WeekTick[] {
  const ticks: WeekTick[] = [];
  for (let day = 0; day < range.days; day += 1) {
    const date = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate() + day);
    if (date.getDay() === 1) ticks.push({ offset: day, label: `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}` });
  }
  return ticks;
}

export interface PlanRow {
  task: Task;
  due: Date | null;
  start: Date | null;
}

export interface PlanGroup {
  /** null = «Без вехи». */
  milestone: Milestone | null;
  /** Tasks that can be drawn (have a deadline or a start). */
  dated: PlanRow[];
  /** Tasks with no date at all — shown as a list, never as an invented marker. */
  undated: Task[];
  open: number;
  closed: number;
}

function parse(iso: string | null): Date | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * The plan grouped by milestone, each group split into what has a date and what has
 * none. A milestone with no tasks still gets its (empty) group: the plan's shape is
 * part of the plan.
 */
export function planGroups(tasks: readonly Task[], milestones: readonly Milestone[]): PlanGroup[] {
  return groupTasksByMilestone(tasks, milestones, true).map((group) => {
    const dated: PlanRow[] = [];
    const undated: Task[] = [];
    for (const task of group.tasks) {
      const due = parse(task.dueAt);
      const start = parse(task.startAt);
      if (due || start) dated.push({ task, due, start });
      else undated.push(task);
    }
    // Chronological inside a group, so the timeline reads top to bottom as left to right.
    dated.sort((a, b) => (a.due ?? a.start!).getTime() - (b.due ?? b.start!).getTime());
    return { milestone: group.milestone, dated, undated, open: group.open, closed: group.closed };
  });
}

/** Every date the axis has to cover (milestones and drawable tasks). */
export function planDates(groups: readonly PlanGroup[]): Date[] {
  const dates: Date[] = [];
  for (const group of groups) {
    const m = group.milestone;
    for (const iso of [m?.startAt ?? null, m?.dueAt ?? null]) {
      const d = parse(iso);
      if (d) dates.push(d);
    }
    for (const row of group.dated) {
      if (row.start) dates.push(row.start);
      if (row.due) dates.push(row.due);
    }
  }
  return dates;
}

import { isTaskClosed, type Task, type TaskPriority } from "./task";

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Local calendar day `[from, to)` as ISO instants — the window `useEvents` wants. */
export function localDayRange(now: Date): { from: string; to: string } {
  const start = startOfLocalDay(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * Last instant of the local day. A "due today" stamp that stays in the today
 * bucket until midnight — not a wall-clock "now", which would be overdue a
 * second later.
 */
export function localDayDueAt(now: Date): string {
  return new Date(new Date(localDayRange(now).to).getTime() - 1).toISOString();
}

/**
 * Monday 00:00 local → next Monday 00:00. Week starts Monday, matching the
 * Russian calendar the rest of the UI already speaks.
 */
export function localWeekRange(now: Date): { from: string; to: string } {
  const start = startOfLocalDay(now);
  const weekday = start.getDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  start.setDate(start.getDate() - daysFromMonday);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export interface TodayTasks {
  overdue: Task[];
  /** Still due later today — overdue items of the same day live only in `overdue`. */
  today: Task[];
  upcoming: Task[];
  /** Up to `limit` things to start now: in progress, then sooner/higher. */
  focus: Task[];
}

function byFocusOrder(a: Task, b: Task): number {
  const progress = Number(b.status === "in_progress") - Number(a.status === "in_progress");
  if (progress !== 0) return progress;
  const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (priority !== 0) return priority;
  if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return a.createdAt.localeCompare(b.createdAt);
}

/**
 * Splits the open task list into the buckets the Today surface needs.
 * Blocked tasks stay in overdue/today lists (they're still due) but never
 * enter focus — you can't start them.
 */
export function partitionOpenTasks(tasks: readonly Task[], now: Date, limit = 3): TodayTasks {
  const open = tasks.filter((task) => !isTaskClosed(task.status));
  const overdue = open
    .filter((task) => task.dueAt && new Date(task.dueAt).getTime() < now.getTime())
    .sort((a, b) => (a.dueAt as string).localeCompare(b.dueAt as string));
  const today = open
    .filter(
      (task) =>
        task.dueAt &&
        isSameLocalDay(new Date(task.dueAt), now) &&
        new Date(task.dueAt).getTime() >= now.getTime()
    )
    .sort((a, b) => (a.dueAt as string).localeCompare(b.dueAt as string));
  const upcoming = open
    .filter((task) => task.dueAt && !isSameLocalDay(new Date(task.dueAt), now) && new Date(task.dueAt).getTime() > now.getTime())
    .sort((a, b) => (a.dueAt as string).localeCompare(b.dueAt as string))
    .slice(0, 5);
  const focus = [...open].filter((task) => !task.blocked).sort(byFocusOrder).slice(0, limit);
  return { overdue, today, upcoming, focus };
}

export interface WeekReview {
  /** Closed this week (`status === "done"` and `completedAt` inside the week). */
  completed: Task[];
  /** Still open, due sometime this week (includes overdue from earlier in the week). */
  remaining: Task[];
  /** Still open, due before this Monday — carry-over from previous weeks. */
  overdueBeforeWeek: Task[];
}

/**
 * Client-side weekly review from the already-loaded task list. No extra
 * endpoint: the Today surface already has every open/closed task.
 */
export function partitionWeekReview(tasks: readonly Task[], now: Date): WeekReview {
  const { from, to } = localWeekRange(now);
  const completed = tasks
    .filter(
      (task) => task.status === "done" && task.completedAt !== null && task.completedAt >= from && task.completedAt < to
    )
    .sort((a, b) => (b.completedAt as string).localeCompare(a.completedAt as string));
  const remaining = tasks
    .filter((task) => !isTaskClosed(task.status) && task.dueAt !== null && task.dueAt >= from && task.dueAt < to)
    .sort((a, b) => (a.dueAt as string).localeCompare(b.dueAt as string));
  const overdueBeforeWeek = tasks
    .filter((task) => !isTaskClosed(task.status) && task.dueAt !== null && task.dueAt < from)
    .sort((a, b) => (a.dueAt as string).localeCompare(b.dueAt as string));
  return { completed, remaining, overdueBeforeWeek };
}

import type { Task } from "@orion/shared-types";
import { isTaskClosed } from "@orion/shared-types";

/**
 * Numbers behind the dashboard's analytics block. One source: the same task list every
 * other panel reads, so a figure here always matches what the Tasks panel would show.
 * Local-time days; pure functions.
 */

export function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

export interface DayFlow {
  key: string;
  /** Short label for the axis, e.g. "13". */
  label: string;
  created: number;
  completed: number;
}

/** Tasks created and completed per local day over the last `days` days, today last. */
export function dailyFlow(tasks: readonly Task[], now: Date, days = 14): DayFlow[] {
  const flow: DayFlow[] = [];
  const index = new Map<string, DayFlow>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const entry: DayFlow = { key: dayKey(date), label: String(date.getDate()), created: 0, completed: 0 };
    flow.push(entry);
    index.set(entry.key, entry);
  }
  for (const task of tasks) {
    const created = new Date(task.createdAt);
    if (!Number.isNaN(created.getTime())) {
      const entry = index.get(dayKey(created));
      if (entry) entry.created += 1;
    }
    if (task.completedAt && task.status === "done") {
      const completed = new Date(task.completedAt);
      if (!Number.isNaN(completed.getTime())) {
        const entry = index.get(dayKey(completed));
        if (entry) entry.completed += 1;
      }
    }
  }
  return flow;
}

export interface Workload {
  open: number;
  inProgress: number;
  /** Open tasks waiting for an unfinished prerequisite. */
  blocked: number;
  overdue: number;
  dueToday: number;
  /** Due within the next 7 days, today excluded. */
  dueWeek: number;
}

export function workload(tasks: readonly Task[], now: Date): Workload {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const weekEnd = tomorrowStart + 7 * 24 * 60 * 60 * 1000;
  const result: Workload = { open: 0, inProgress: 0, blocked: 0, overdue: 0, dueToday: 0, dueWeek: 0 };
  for (const task of tasks) {
    if (isTaskClosed(task.status)) continue;
    result.open += 1;
    if (task.status === "in_progress") result.inProgress += 1;
    if (task.blocked) result.blocked += 1;
    if (!task.dueAt) continue;
    const due = new Date(task.dueAt).getTime();
    if (Number.isNaN(due)) continue;
    // Same meaning as everywhere else (calendar, badges): overdue = the moment has passed.
    if (due < now.getTime()) result.overdue += 1;
    else if (due < tomorrowStart) result.dueToday += 1;
    else if (due < weekEnd) result.dueWeek += 1;
  }
  return result;
}

/** Completion over the window: how many tasks were closed vs. opened, and the net backlog change. */
export function flowTotals(flow: readonly DayFlow[]): { created: number; completed: number; net: number } {
  const created = flow.reduce((sum, day) => sum + day.created, 0);
  const completed = flow.reduce((sum, day) => sum + day.completed, 0);
  return { created, completed, net: created - completed };
}

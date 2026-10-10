import { isTaskClosed, type Milestone, type Task } from "@orion/shared-types";
import { compareTasksByFocus } from "./project-focus";
import { daysUntil } from "./project-status";

/**
 * A project's tasks laid out on two axes: the DIRECTION inside the project (its
 * milestones, in the project's own order, plus "Без вехи") across, and URGENCY
 * down. One glance answers both "what is burning" and "in which part of the
 * project". Framework-free so the placement rules are tested.
 */

export type UrgencyRow = "overdue" | "today" | "week" | "later" | "none" | "closed";

export const URGENCY_ORDER: readonly UrgencyRow[] = ["overdue", "today", "week", "later", "none", "closed"];

export const URGENCY_LABEL: Record<UrgencyRow, string> = {
  overdue: "Просрочено",
  today: "Сегодня",
  week: "На неделе",
  later: "Позже",
  none: "Без срока",
  closed: "Закрыто"
};

/** Where a task sits on the urgency axis. Closed work is its own row, whatever its date was. */
export function urgencyRow(task: Pick<Task, "dueAt" | "status">, now: Date = new Date()): UrgencyRow {
  if (isTaskClosed(task.status)) return "closed";
  if (!task.dueAt) return "none";
  const days = daysUntil(task.dueAt, now);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "week";
  return "later";
}

export interface MatrixColumn {
  /** null = tasks with no milestone ("Без вехи"). */
  milestone: Milestone | null;
  /** Stable key for React and drop targets. */
  key: string;
  open: number;
  closed: number;
}

export interface TaskMatrix {
  columns: MatrixColumn[];
  /** Only the rows that hold at least one task — an empty "Позже" row is noise. */
  rows: UrgencyRow[];
  /** `cells[rowKey][columnKey]` → tasks in work order. */
  cells: Record<string, Record<string, Task[]>>;
}

export const NO_MILESTONE_KEY = "__none__";

/**
 * Lays tasks out on the matrix. Closed tasks appear (in the "Закрыто" row) only
 * when `includeClosed` is on, but the per-column tallies always count them, so
 * a column's "3/7" stays true whatever is shown. A column for milestones is
 * always present (an empty stage is part of the plan's shape); "Без вехи" only
 * when some task actually belongs there.
 */
export function buildTaskMatrix(
  tasks: readonly Task[],
  milestones: readonly Milestone[],
  includeClosed: boolean,
  now: Date = new Date()
): TaskMatrix {
  const ordered = [...milestones].sort((a, b) => a.order - b.order);
  const known = new Set(ordered.map((milestone) => milestone.id));
  const columnKeyOf = (task: Task): string =>
    task.milestoneId && known.has(task.milestoneId) ? task.milestoneId : NO_MILESTONE_KEY;

  const columns: MatrixColumn[] = ordered.map((milestone) => ({ milestone, key: milestone.id, open: 0, closed: 0 }));
  const loose = tasks.filter((task) => columnKeyOf(task) === NO_MILESTONE_KEY);
  if (loose.length > 0 || ordered.length === 0) {
    columns.push({ milestone: null, key: NO_MILESTONE_KEY, open: 0, closed: 0 });
  }
  const column = new Map(columns.map((c) => [c.key, c]));

  const cells: Record<string, Record<string, Task[]>> = {};
  const used = new Set<UrgencyRow>();
  for (const task of tasks) {
    const key = columnKeyOf(task);
    const target = column.get(key);
    if (!target) continue;
    if (isTaskClosed(task.status)) target.closed += 1;
    else target.open += 1;

    const row = urgencyRow(task, now);
    if (row === "closed" && !includeClosed) continue;
    used.add(row);
    ((cells[row] ??= {})[key] ??= []).push(task);
  }
  for (const byColumn of Object.values(cells)) {
    for (const list of Object.values(byColumn)) list.sort(compareTasksByFocus);
  }

  return { columns, rows: URGENCY_ORDER.filter((row) => used.has(row)), cells };
}

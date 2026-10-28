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
 * ORION-03, Эйзенхауэр: an alternative view of the same tasks, important × urgent, not a
 * second data model. Both buckets are explicit, documented rules over existing fields — never
 * invented values — per the risk note: "не вычислять важность только из приоритета... без
 * прозрачного правила". «Важность» here IS exactly `priority === "high"`, shown as such in the
 * UI; «Срочность» is overdue-or-due-within-3-days, the same `dueAt` the plain urgency rows above
 * already read. Dragging a card between the importance columns edits `priority` (an explicit,
 * named field); the urgency row is look-only, same as the milestone matrix never lets a drop
 * invent a due date.
 */
export type EisenhowerUrgency = "urgent" | "notUrgent";
export type EisenhowerImportance = "important" | "notImportant";

export const EISENHOWER_URGENT_WITHIN_DAYS = 3;

export function eisenhowerUrgency(task: Pick<Task, "dueAt">, now: Date = new Date()): EisenhowerUrgency {
  if (!task.dueAt) return "notUrgent";
  return daysUntil(task.dueAt, now) <= EISENHOWER_URGENT_WITHIN_DAYS ? "urgent" : "notUrgent";
}

export function eisenhowerImportance(task: Pick<Task, "priority">): EisenhowerImportance {
  return task.priority === "high" ? "important" : "notImportant";
}

export const EISENHOWER_URGENCY_LABEL: Record<EisenhowerUrgency, string> = { urgent: "Срочно", notUrgent: "Не срочно" };
export const EISENHOWER_IMPORTANCE_LABEL: Record<EisenhowerImportance, string> = { important: "Важно", notImportant: "Не важно" };
/** Shown under each column header so "важно" never reads as a mystery field. */
export const EISENHOWER_IMPORTANCE_HINT: Record<EisenhowerImportance, string> = {
  important: "приоритет «высокий»",
  notImportant: "приоритет не «высокий»"
};
export const EISENHOWER_QUADRANT_HINT: Record<EisenhowerImportance, Record<EisenhowerUrgency, string>> = {
  important: { urgent: "Делать сейчас", notUrgent: "Планировать" },
  notImportant: { urgent: "Делегировать или сократить", notUrgent: "Отложить или удалить" }
};

export interface EisenhowerMatrix {
  /** Only rows that hold at least one task, plus "Закрыто" when `includeClosed`. */
  rows: ("urgent" | "notUrgent" | "closed")[];
  /** `cells[row][importance]` → tasks in work order. */
  cells: Record<string, Record<EisenhowerImportance, Task[]>>;
}

export function buildEisenhowerMatrix(tasks: readonly Task[], includeClosed: boolean, now: Date = new Date()): EisenhowerMatrix {
  const cells: Record<string, Record<EisenhowerImportance, Task[]>> = {};
  const used = new Set<"urgent" | "notUrgent" | "closed">();
  for (const task of tasks) {
    const row = isTaskClosed(task.status) ? "closed" : eisenhowerUrgency(task, now);
    if (row === "closed" && !includeClosed) continue;
    used.add(row);
    const bucket = (cells[row] ??= { important: [], notImportant: [] });
    bucket[eisenhowerImportance(task)].push(task);
  }
  for (const byImportance of Object.values(cells)) {
    for (const list of Object.values(byImportance)) list.sort(compareTasksByFocus);
  }
  const order: ("urgent" | "notUrgent" | "closed")[] = ["urgent", "notUrgent", "closed"];
  return { rows: order.filter((row) => used.has(row)), cells };
}

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

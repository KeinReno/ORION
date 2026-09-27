import { isTaskClosed, type Milestone, type Task, type TaskPriority, type TaskStatus } from "@orion/shared-types";

/**
 * The project tab's "what's going on here" logic, kept framework-free so it
 * is unit-testable (see project-focus.test.ts). The project screen used to be
 * a Sheet of counters ("1/5", "Заметки: 3") — this is what turns the raw task
 * list into the answers the screen now leads with: what's next, what's on
 * fire, how far the nearest milestone is.
 */

const STATUS_RANK: Record<TaskStatus, number> = { in_progress: 0, todo: 1, backlog: 2, done: 3, canceled: 4 };
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

function dueMs(task: Pick<Task, "dueAt">): number {
  if (!task.dueAt) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(task.dueAt);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

export function isTaskOverdue(task: Pick<Task, "dueAt" | "status">, now: Date = new Date()): boolean {
  return !isTaskClosed(task.status) && dueMs(task) < now.getTime();
}

/**
 * Work order for open tasks: already started first, then the soonest
 * deadline, then priority, then the user's own manual order. Closed tasks
 * sink to the end (done before canceled), newest completion first.
 */
export function compareTasksByFocus(a: Task, b: Task): number {
  const aClosed = isTaskClosed(a.status);
  const bClosed = isTaskClosed(b.status);
  if (aClosed !== bClosed) return aClosed ? 1 : -1;
  if (aClosed) {
    const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (byStatus !== 0) return byStatus;
    return (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt);
  }
  const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (byStatus !== 0) return byStatus;
  const byDue = dueMs(a) - dueMs(b);
  if (byDue !== 0 && !Number.isNaN(byDue)) return byDue;
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;
  return a.sortOrder - b.sortOrder;
}

export interface MilestoneFocus {
  milestone: Milestone;
  open: number;
  total: number;
}

export interface ProjectFocus {
  /** Open, unblocked tasks in work order — the "Дальше" list (capped by `nextLimit`). */
  next: Task[];
  /** Open tasks past their deadline, oldest deadline first. */
  overdue: Task[];
  /** Open tasks waiting on an unfinished dependency (and not already in `overdue`). */
  blocked: Task[];
  inProgress: number;
  open: number;
  /** First not-done milestone by the project's own order, with its task tally. */
  nextMilestone: MilestoneFocus | null;
}

export function projectFocus(
  tasks: readonly Task[],
  milestones: readonly Milestone[],
  now: Date = new Date(),
  nextLimit = 5
): ProjectFocus {
  const open = tasks.filter((task) => !isTaskClosed(task.status));
  const overdue = open.filter((task) => isTaskOverdue(task, now)).sort((a, b) => dueMs(a) - dueMs(b));
  const overdueIds = new Set(overdue.map((task) => task.id));
  const blocked = open.filter((task) => task.blocked && !overdueIds.has(task.id));
  const next = open
    .filter((task) => !task.blocked)
    .sort(compareTasksByFocus)
    .slice(0, nextLimit);

  const upcoming = [...milestones].sort((a, b) => a.order - b.order).find((milestone) => milestone.status !== "done");
  let nextMilestone: MilestoneFocus | null = null;
  if (upcoming) {
    const own = tasks.filter((task) => task.milestoneId === upcoming.id);
    nextMilestone = {
      milestone: upcoming,
      total: own.length,
      open: own.filter((task) => !isTaskClosed(task.status)).length
    };
  }

  return {
    next,
    overdue,
    blocked,
    inProgress: open.filter((task) => task.status === "in_progress").length,
    open: open.length,
    nextMilestone
  };
}

export interface MilestoneTaskGroup {
  /** null = tasks with no milestone ("Без вехи"), always the last group. */
  milestone: Milestone | null;
  tasks: Task[];
  open: number;
  closed: number;
}

/**
 * Tasks grouped the way the plan is: one group per milestone in the project's
 * order, then "Без вехи". A milestone with no tasks still gets its (empty)
 * group so the plan's shape is visible. `includeClosed: false` drops done /
 * canceled rows but keeps the counters honest.
 */
export function groupTasksByMilestone(
  tasks: readonly Task[],
  milestones: readonly Milestone[],
  includeClosed: boolean
): MilestoneTaskGroup[] {
  const known = new Set(milestones.map((milestone) => milestone.id));
  const groups: MilestoneTaskGroup[] = [...milestones]
    .sort((a, b) => a.order - b.order)
    .map((milestone) => buildGroup(milestone, tasks.filter((task) => task.milestoneId === milestone.id), includeClosed));
  const loose = tasks.filter((task) => !task.milestoneId || !known.has(task.milestoneId));
  if (loose.length > 0) groups.push(buildGroup(null, loose, includeClosed));
  return groups;
}

function buildGroup(milestone: Milestone | null, own: Task[], includeClosed: boolean): MilestoneTaskGroup {
  const closed = own.filter((task) => isTaskClosed(task.status)).length;
  const visible = includeClosed ? own : own.filter((task) => !isTaskClosed(task.status));
  return { milestone, tasks: [...visible].sort(compareTasksByFocus), open: own.length - closed, closed };
}

import { z } from "zod";
import { milestoneStatusSchema } from "./milestone";
import { isTaskClosed, taskPrioritySchema, taskStatusSchema, type TaskPriority, type TaskStatus } from "./task";

/**
 * Global goals (plugin `projects-goals`). A goal is an outcome; its PLANS are projects, each
 * with a weight. A project keeps its own milestones and tasks — the goal only links to it.
 */
export const goalStatusSchema = z.enum(["active", "achieved", "dropped"]);
export type GoalStatus = z.infer<typeof goalStatusSchema>;

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  active: "В работе",
  achieved: "Достигнута",
  dropped: "Отменена"
};

/** The one task a plan would do next (see `summarizePlanTasks`). */
export const goalNextTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  dueAt: z.string().nullable(),
  overdue: z.boolean()
});
export type GoalNextTask = z.infer<typeof goalNextTaskSchema>;

/** A project milestone seen from a goal: a waypoint on the way through the plan. */
export const goalMilestoneSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: milestoneStatusSchema,
  dueAt: z.string().nullable(),
  tasks: z.number().int(),
  closed: z.number().int()
});
export type GoalMilestone = z.infer<typeof goalMilestoneSchema>;

export const goalPlanSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  projectArchived: z.boolean(),
  weight: z.number().int().min(1).max(100),
  /** The plan's own progress, 0–100; null = the project has no tasks yet, i.e. unknown (not 0). */
  progress: z.number().min(0).max(100).nullable(),
  tasks: z.number().int(),
  closed: z.number().int(),
  /** First open, unblocked task in working order; null = nothing to do right now (see `blocked`). */
  nextTask: goalNextTaskSchema.nullable(),
  /** Open tasks waiting on another open task. */
  blocked: z.number().int(),
  /** Open tasks past their due date. */
  overdue: z.number().int(),
  /** Latest change to any task of the project; null = the project has no tasks. */
  lastActivityAt: z.string().nullable(),
  /** The project's milestones in plan order (all of them; the sky shows a window, see `milestoneWindow`). */
  milestones: z.array(goalMilestoneSchema)
});
export type GoalPlan = z.infer<typeof goalPlanSchema>;

export const goalSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  description: z.string(),
  status: goalStatusSchema,
  dueAt: z.string().nullable(),
  /** Parent goal; null = top-level. Depth is capped at GOAL_MAX_DEPTH. */
  parentId: z.string().nullable(),
  /** Weight of this goal inside its parent's progress (ignored for top-level goals). */
  subWeight: z.number().int().min(1).max(100),
  /** Number of direct sub-goals. */
  subGoalCount: z.number().int(),
  plans: z.array(goalPlanSchema),
  /** Weighted progress of the known plans AND sub-goals; null when none is known. */
  progress: z.number().min(0).max(100).nullable(),
  /** Plans left out of `progress` because they have no tasks yet. */
  unknownPlans: z.number().int(),
  /** Direct sub-goals left out of `progress` because their own progress is unknown. */
  unknownSubGoals: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Goal = z.infer<typeof goalSchema>;

export const createGoalInputSchema = z.object({
  title: z.string().trim().min(1, "Название обязательно").max(200),
  description: z.string().max(20_000).default(""),
  dueAt: z.string().datetime().nullable().optional(),
  parentId: z.string().min(1).nullable().optional(),
  subWeight: z.number().int().min(1).max(100).default(1)
});
export type CreateGoalInput = z.infer<typeof createGoalInputSchema>;

export const updateGoalInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  status: goalStatusSchema.optional(),
  dueAt: z.string().datetime().nullable().optional(),
  /** null = make top-level. */
  parentId: z.string().min(1).nullable().optional(),
  subWeight: z.number().int().min(1).max(100).optional()
});
export type UpdateGoalInput = z.infer<typeof updateGoalInputSchema>;

export const addGoalPlanInputSchema = z.object({
  projectId: z.string().min(1),
  weight: z.number().int().min(1).max(100).default(1)
});
export type AddGoalPlanInput = z.infer<typeof addGoalPlanInputSchema>;

export const updateGoalPlanInputSchema = z.object({
  weight: z.number().int().min(1).max(100)
});
export type UpdateGoalPlanInput = z.infer<typeof updateGoalPlanInputSchema>;

/**
 * The one rule for goal progress: the weighted mean of the plans that HAVE tasks.
 * A plan with no tasks is unknown, not 0 % — counting it as 0 would make a freshly added
 * plan drag a goal backwards, and counting it as 100 would be a lie. `unknown` says how
 * many plans were left out so the UI can say "по 2 из 3 планов".
 */
export function goalProgress(plans: ReadonlyArray<{ weight: number; progress: number | null }>): {
  progress: number | null;
  unknown: number;
} {
  let weighted = 0;
  let total = 0;
  let unknown = 0;
  for (const plan of plans) {
    if (plan.progress === null) {
      unknown += 1;
      continue;
    }
    weighted += plan.weight * plan.progress;
    total += plan.weight;
  }
  return { progress: total === 0 ? null : Math.round(weighted / total), unknown };
}

export interface PulseTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  sortOrder: number;
  updatedAt: Date;
  /** Waits on at least one OPEN task. */
  blocked: boolean;
}

export interface PlanPulse {
  nextTask: GoalNextTask | null;
  blocked: number;
  overdue: number;
  lastActivityAt: string | null;
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };
const STATUS_RANK: Record<TaskStatus, number> = { in_progress: 0, todo: 1, backlog: 2, done: 3, canceled: 3 };

/**
 * What a plan (a project's tasks) says about the way forward. The next task is the open,
 * unblocked one a person would pick: already started first, then the earliest due date, then
 * priority, then the board order. A blocked task is never "next" — it is counted in `blocked`
 * so the sky can show a stuck branch instead of pointing at work that cannot start.
 */
export function summarizePlanTasks(tasks: ReadonlyArray<PulseTask>, now: Date): PlanPulse {
  const open = tasks.filter((t) => !isTaskClosed(t.status));
  const isOverdue = (t: PulseTask): boolean => t.dueAt !== null && t.dueAt.getTime() < now.getTime();
  const ready = open.filter((t) => !t.blocked);
  ready.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      (a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.sortOrder - b.sortOrder ||
      a.title.localeCompare(b.title, "ru")
  );
  const next = ready[0];
  const last = tasks.reduce<number | null>((max, t) => (max === null || t.updatedAt.getTime() > max ? t.updatedAt.getTime() : max), null);
  return {
    nextTask: next
      ? {
          id: next.id,
          title: next.title,
          status: next.status,
          priority: next.priority,
          dueAt: next.dueAt?.toISOString() ?? null,
          overdue: isOverdue(next)
        }
      : null,
    blocked: open.filter((t) => t.blocked).length,
    overdue: open.filter(isOverdue).length,
    lastActivityAt: last === null ? null : new Date(last).toISOString()
  };
}

/** How many milestones the sky draws per plan. */
export const MILESTONE_WINDOW = 4;

/**
 * Which milestones to draw on a plan's branch: the whole route when it is short, otherwise a
 * window that starts one step behind the first unfinished milestone (so the last passed waypoint
 * stays visible) — the sky shows where you are, not the entire history.
 */
export function milestoneWindow<T extends { status: "planned" | "in_progress" | "done" }>(milestones: ReadonlyArray<T>): T[] {
  if (milestones.length <= MILESTONE_WINDOW) return [...milestones];
  const firstOpen = milestones.findIndex((m) => m.status !== "done");
  const from = firstOpen === -1 ? milestones.length - MILESTONE_WINDOW : Math.min(Math.max(0, firstOpen - 1), milestones.length - MILESTONE_WINDOW);
  return milestones.slice(from, from + MILESTONE_WINDOW);
}

export type GoalPaceState = "on_track" | "behind" | "late" | "unknown" | "none";

export interface GoalPace {
  state: GoalPaceState;
  /** Share of the time between start and deadline that has passed, 0–100; null = no deadline. */
  elapsed: number | null;
}

/** Progress may trail the clock by this many points before the goal counts as behind. */
export const PACE_TOLERANCE = 15;

/**
 * Is the goal keeping up with its deadline? The clock runs from `start` (the goal's creation —
 * there is no separate start date yet) to `dueAt`; the goal is "behind" when its progress trails
 * the elapsed share of that span by more than PACE_TOLERANCE, "late" once the deadline passed
 * unfinished. Unknown progress is "unknown", never assumed 0 — and finished or dropped goals have no pace.
 */
export function goalPace(
  goal: { status: GoalStatus; createdAt: string; dueAt: string | null; progress: number | null },
  now: Date
): GoalPace {
  if (goal.status !== "active" || goal.dueAt === null) return { state: "none", elapsed: null };
  const start = new Date(goal.createdAt).getTime();
  const due = new Date(goal.dueAt).getTime();
  const span = due - start;
  const elapsed = span <= 0 ? 100 : Math.min(100, Math.max(0, Math.round(((now.getTime() - start) / span) * 100)));
  if (now.getTime() > due) return { state: goal.progress === 100 ? "none" : "late", elapsed: 100 };
  if (goal.progress === null) return { state: "unknown", elapsed };
  return { state: goal.progress < elapsed - PACE_TOLERANCE ? "behind" : "on_track", elapsed };
}

/** Goals nest at most this deep: goal (1) -> sub-goal (2) -> sub-sub-goal (3). */
export const GOAL_MAX_DEPTH = 3;

export interface GoalTreeNode {
  id: string;
  parentId: string | null;
  subWeight: number;
  plans: ReadonlyArray<{ weight: number; progress: number | null }>;
}

export interface GoalTreeProgress {
  progress: number | null;
  unknownPlans: number;
  unknownSubGoals: number;
}

/**
 * Progress of every goal in a flat list. A goal is the weighted mean of its known direct plans
 * AND its known direct sub-goals (a sub-goal's weight is its `subWeight`). A sub-goal whose own
 * progress is unknown (null) is left out, exactly like a plan without tasks — never counted as 0.
 * A parent link that points outside the list or closes a cycle is ignored (defensive: the API
 * rejects both, a hand-edited snapshot could contain them).
 */
export function goalTreeProgress(nodes: ReadonlyArray<GoalTreeNode>): Map<string, GoalTreeProgress> {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, GoalTreeNode[]>();
  for (const node of nodes) {
    if (node.parentId && node.parentId !== node.id && ids.has(node.parentId)) {
      const list = children.get(node.parentId) ?? [];
      list.push(node);
      children.set(node.parentId, list);
    }
  }
  const result = new Map<string, GoalTreeProgress>();
  const visiting = new Set<string>();

  function compute(node: GoalTreeNode): GoalTreeProgress {
    const cached = result.get(node.id);
    if (cached) return cached;
    visiting.add(node.id);
    const planItems = [...node.plans];
    const subItems: Array<{ weight: number; progress: number | null }> = [];
    for (const child of children.get(node.id) ?? []) {
      if (visiting.has(child.id)) continue; // cycle: skip the back edge
      subItems.push({ weight: child.subWeight, progress: compute(child).progress });
    }
    visiting.delete(node.id);
    const { progress } = goalProgress([...planItems, ...subItems]);
    const value = {
      progress,
      unknownPlans: planItems.filter((i) => i.progress === null).length,
      unknownSubGoals: subItems.filter((i) => i.progress === null).length
    };
    result.set(node.id, value);
    return value;
  }

  for (const node of nodes) compute(node);
  return result;
}

export type GoalParentCheck = { ok: true } | { ok: false; reason: "self" | "cycle" | "depth" | "missing" };

/**
 * May `goalId` (null = a goal being created) be placed under `parentId`? Rejects itself, its own
 * descendants (cycle), and any placement that would push the moved subtree past GOAL_MAX_DEPTH.
 * `nodes` is the whole workspace's goals as (id, parentId).
 */
export function checkGoalParent(
  goalId: string | null,
  parentId: string | null,
  nodes: ReadonlyArray<{ id: string; parentId: string | null }>
): GoalParentCheck {
  if (parentId === null) return { ok: true };
  if (goalId !== null && goalId === parentId) return { ok: false, reason: "self" };
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  if (!parentOf.has(parentId)) return { ok: false, reason: "missing" };
  // Walk up from the new parent: meeting goalId means the parent is its descendant.
  let depth = 0;
  const seen = new Set<string>();
  for (let cur: string | null = parentId; cur !== null; cur = parentOf.get(cur) ?? null) {
    if ((goalId !== null && cur === goalId) || seen.has(cur)) return { ok: false, reason: "cycle" };
    seen.add(cur);
    depth += 1;
  }
  const height = goalId === null ? 1 : goalSubtreeHeight(goalId, nodes);
  return depth + height > GOAL_MAX_DEPTH ? { ok: false, reason: "depth" } : { ok: true };
}

/** Levels in the subtree rooted at `goalId` (a leaf = 1). */
export function goalSubtreeHeight(goalId: string, nodes: ReadonlyArray<{ id: string; parentId: string | null }>): number {
  const children = new Map<string, string[]>();
  for (const n of nodes) if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
  const seen = new Set<string>();
  const walk = (id: string): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    let best = 0;
    for (const c of children.get(id) ?? []) best = Math.max(best, walk(c));
    return best + 1;
  };
  return walk(goalId);
}

/** One reconstructed moment of a project: how many tasks existed and how many of them were closed. */
export const goalHistoryCountSchema = z.object({ tasks: z.number().int(), closed: z.number().int() });
export type GoalHistoryCount = z.infer<typeof goalHistoryCountSchema>;

/** Progress of the projects behind the goals at weekly points in the past (oldest first, newest = now). */
export const goalHistorySchema = z.object({
  points: z.array(z.string()),
  /** projectId -> one count per point. */
  projects: z.record(z.array(goalHistoryCountSchema))
});
export type GoalHistory = z.infer<typeof goalHistorySchema>;

export const GOAL_HISTORY_MAX_WEEKS = 52;

/** `weeks + 1` weekly moments, oldest first, the last one being `now`. */
export function historyPoints(now: Date, weeks: number): Date[] {
  const count = Math.min(GOAL_HISTORY_MAX_WEEKS, Math.max(1, Math.round(weeks)));
  return Array.from({ length: count + 1 }, (_, i) => new Date(now.getTime() - (count - i) * 7 * 86_400_000));
}

/**
 * What a project looked like at each point, rebuilt from its tasks' own dates — there is no stored
 * history. A task counts from its creation; it counts as closed from `closedAt`. This is an honest
 * approximation: tasks deleted since, or reopened after being closed, are invisible to it.
 */
export function projectHistory(tasks: ReadonlyArray<{ createdAt: Date; closedAt: Date | null }>, points: ReadonlyArray<Date>): GoalHistoryCount[] {
  return points.map((point) => {
    const t = point.getTime();
    let total = 0;
    let closed = 0;
    for (const task of tasks) {
      if (task.createdAt.getTime() > t) continue;
      total += 1;
      if (task.closedAt !== null && task.closedAt.getTime() <= t) closed += 1;
    }
    return { tasks: total, closed };
  });
}

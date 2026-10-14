import { z } from "zod";

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

export const goalPlanSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  projectArchived: z.boolean(),
  weight: z.number().int().min(1).max(100),
  /** The plan's own progress, 0–100; null = the project has no tasks yet, i.e. unknown (not 0). */
  progress: z.number().min(0).max(100).nullable(),
  tasks: z.number().int(),
  closed: z.number().int()
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

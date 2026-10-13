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
  plans: z.array(goalPlanSchema),
  /** Weighted progress of the plans whose progress is known; null when none is. */
  progress: z.number().min(0).max(100).nullable(),
  /** Plans left out of `progress` because they have no tasks yet. */
  unknownPlans: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Goal = z.infer<typeof goalSchema>;

export const createGoalInputSchema = z.object({
  title: z.string().trim().min(1, "Название обязательно").max(200),
  description: z.string().max(20_000).default(""),
  dueAt: z.string().datetime().nullable().optional()
});
export type CreateGoalInput = z.infer<typeof createGoalInputSchema>;

export const updateGoalInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  status: goalStatusSchema.optional(),
  dueAt: z.string().datetime().nullable().optional()
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

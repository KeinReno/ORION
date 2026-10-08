import { z } from "zod";

/**
 * UI-05 «Обновление состояния проекта». A manual, authored report — not a
 * forecast. The computed indicators (progress, overdue, next milestone) stay
 * separate and machine-derived; this one answers "what does the person
 * running the project say right now", with a name and a date.
 */
export const PROJECT_HEALTH = ["on_track", "at_risk", "delayed"] as const;
export const projectHealthSchema = z.enum(PROJECT_HEALTH);
export type ProjectHealth = z.infer<typeof projectHealthSchema>;

export const PROJECT_HEALTH_LABEL: Record<ProjectHealth, string> = {
  on_track: "По плану",
  at_risk: "Есть риск",
  delayed: "Задержка"
};

export const projectUpdateSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  health: projectHealthSchema,
  /** What changed since the previous report. */
  summary: z.string(),
  blocker: z.string(),
  nextStep: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  /** True when the caller wrote it — gates the delete button. */
  mine: z.boolean(),
  createdAt: z.string()
});
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;

/** The author is stamped from the session, never taken from the payload. */
export const createProjectUpdateInputSchema = z.object({
  health: projectHealthSchema,
  summary: z.string().trim().min(1, "Опишите, что изменилось").max(2000),
  blocker: z.string().trim().max(1000).default(""),
  nextStep: z.string().trim().max(1000).default("")
});
export type CreateProjectUpdateInput = z.infer<typeof createProjectUpdateInputSchema>;

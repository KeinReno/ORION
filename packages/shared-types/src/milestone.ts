import { z } from "zod";

/**
 * ORION v0.27 «План проекта» — see docs/HISTORY.md. A milestone is the second
 * level of the Gantt (tasks are the first): a phase with its own bar,
 * independent of whatever tasks happen to be grouped under it via
 * `Task.milestoneId`.
 */

export const milestoneStatusSchema = z.enum(["planned", "in_progress", "done"]);
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;

export const milestoneSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  title: z.string(),
  note: z.string(),
  status: milestoneStatusSchema,
  startAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  estimatedMinutes: z.number().int().nullable(),
  order: z.number().int(),
  dependencyIds: z.array(z.string()),
  /** Mirrors `Task.blocked` — at least one dependency isn't `done` yet. */
  blocked: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Milestone = z.infer<typeof milestoneSchema>;

export const createMilestoneInputSchema = z.object({
  projectId: z.string(),
  title: z.string().trim().min(1, "Название обязательно").max(200),
  note: z.string().max(4_000).default(""),
  status: milestoneStatusSchema.default("planned"),
  startAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  estimatedMinutes: z.number().int().min(0).nullable().optional(),
  order: z.number().int().default(0),
  dependencyIds: z.array(z.string()).max(50).optional()
});
export type CreateMilestoneInput = z.infer<typeof createMilestoneInputSchema>;

export const updateMilestoneInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  note: z.string().max(4_000).optional(),
  status: milestoneStatusSchema.optional(),
  startAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  estimatedMinutes: z.number().int().min(0).nullable().optional(),
  order: z.number().int().optional(),
  dependencyIds: z.array(z.string()).max(50).optional()
});
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneInputSchema>;

/**
 * S14a — "cascade preview". `MilestonesService.update` silently
 * finish-to-start reschedules any dependent milestone whose start would now
 * precede its predecessor's due date (`cascadeRescheduleTx`); a Gantt
 * drag-resize could therefore move milestones the user never touched
 * without them seeing it happen. This input feeds a read-only simulation of
 * that same algorithm — given a *hypothetical* new startAt/dueAt for one
 * milestone, not yet written — so the UI can show "will also move: …" and
 * let the user confirm before the real PATCH commits it.
 */
export const milestoneReschedulePreviewInputSchema = z.object({
  startAt: z.string().datetime().nullable(),
  dueAt: z.string().datetime().nullable()
});
export type MilestoneReschedulePreviewInput = z.infer<typeof milestoneReschedulePreviewInputSchema>;

/** One dependent milestone the preview/apply cascade would move, before → after. */
export const milestoneCascadeImpactSchema = z.object({
  milestoneId: z.string(),
  title: z.string(),
  previousStartAt: z.string().nullable(),
  previousDueAt: z.string().nullable(),
  nextStartAt: z.string().nullable(),
  nextDueAt: z.string().nullable()
});
export type MilestoneCascadeImpact = z.infer<typeof milestoneCascadeImpactSchema>;

import { z } from "zod";

export const taskStatusSchema = z.enum(["backlog", "todo", "in_progress", "done", "canceled"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/**
 * Terminal statuses — the task is not "open" any more. Single source of truth
 * for every "is this still actionable" decision: overdue counters, the due-task
 * cron, desktop reminders, the calendar's overdue flag and the blocked-by
 * indicator all used to hardcode `status !== "done"`, which silently started
 * treating a canceled task as overdue once `canceled` was added to the enum.
 */
export const TASK_CLOSED_STATUSES: readonly TaskStatus[] = ["done", "canceled"];

export function isTaskClosed(status: TaskStatus): boolean {
  return TASK_CLOSED_STATUSES.includes(status);
}

export const taskPrioritySchema = z.enum(["low", "normal", "high"]);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const taskRecurrenceSchema = z.object({
  freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).max(365)
});
export type TaskRecurrence = z.infer<typeof taskRecurrenceSchema>;

/** One line of a task checklist (a checkup). Order in the array is the display order. */
export const TASK_CHECKLIST_LIMIT = 30;
export const taskChecklistItemSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  done: z.boolean()
});
export type TaskChecklistItem = z.infer<typeof taskChecklistItemSchema>;
export const taskChecklistSchema = z.array(taskChecklistItemSchema).max(TASK_CHECKLIST_LIMIT);

export const taskSchema = z.object({
  id: z.string(),
  /** Concurrency token — send it back as `expectedRevision` when saving an edit made on top of this copy. */
  revision: z.number().int(),
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  parentId: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  dueAt: z.string().nullable(),
  projectTag: z.string().nullable(),
  recurrence: taskRecurrenceSchema.nullable(),
  completedAt: z.string().nullable(),
  sortOrder: z.number().int(),
  dependencyIds: z.array(z.string()),
  blocked: z.boolean(),
  /** "Команда" plugin — a WorkspaceMember id, not a User id. Kept even if the plugin is later disabled. */
  assigneeId: z.string().nullable(),
  /** Gantt bar's left edge — independent of `dueAt` (the "finish" edge); see schema.prisma. */
  startAt: z.string().nullable(),
  /** Planned minutes — "план" side of план/факт. Факт is `entryMinutes` over this task's TimeEntry rows. */
  estimatedMinutes: z.number().int().nullable(),
  milestoneId: z.string().nullable(),
  checklist: taskChecklistSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Task = z.infer<typeof taskSchema>;

export const createTaskInputSchema = z.object({
  title: z.string().min(1, "Заголовок обязателен").max(200),
  description: z.string().max(20_000).default(""),
  priority: taskPrioritySchema.default("normal"),
  dueAt: z.string().datetime().nullable().optional(),
  projectTag: z.string().max(60).nullable().optional(),
  projectId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  recurrence: taskRecurrenceSchema.nullable().optional(),
  dependencyIds: z.array(z.string()).max(50).optional(),
  assigneeId: z.string().nullable().optional(),
  startAt: z.string().datetime().nullable().optional(),
  estimatedMinutes: z.number().int().min(0).nullable().optional(),
  milestoneId: z.string().nullable().optional(),
  /** Module «Дом»: attach to this home on creation (the home must be in the same workspace). */
  homeId: z.string().nullable().optional(),
  checklist: taskChecklistSchema.default([])
});
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

export const updateTaskInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  dueAt: z.string().datetime().nullable().optional(),
  projectTag: z.string().max(60).nullable().optional(),
  projectId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  recurrence: taskRecurrenceSchema.nullable().optional(),
  sortOrder: z.number().int().optional(),
  dependencyIds: z.array(z.string()).max(50).optional(),
  assigneeId: z.string().nullable().optional(),
  startAt: z.string().datetime().nullable().optional(),
  estimatedMinutes: z.number().int().min(0).nullable().optional(),
  milestoneId: z.string().nullable().optional(),
  checklist: taskChecklistSchema.optional(),
  /** The `revision` this edit was based on. Omitted by drag/quick actions (last write wins); the detail pane's autosave sends it. A mismatch is a 409. */
  expectedRevision: z.number().int().optional()
});
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

/// Body of the 409 thrown by `PATCH .../tasks/:id` when `expectedRevision` is stale.
export const taskConflictSchema = z.object({
  code: z.literal("task_revision_conflict"),
  currentRevision: z.number().int(),
  current: taskSchema
});
export type TaskConflict = z.infer<typeof taskConflictSchema>;

export const taskViewFiltersSchema = z.object({
  statuses: z.array(taskStatusSchema).optional(),
  priorities: z.array(taskPrioritySchema).optional(),
  projectId: z.string().nullable().optional(),
  due: z.enum(["all", "overdue", "today", "week", "none"]).optional(),
  search: z.string().max(200).optional()
});
export type TaskViewFilters = z.infer<typeof taskViewFiltersSchema>;

export const savedTaskViewSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  filters: taskViewFiltersSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});
export type SavedTaskView = z.infer<typeof savedTaskViewSchema>;

export const createSavedTaskViewInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  filters: taskViewFiltersSchema
});
export type CreateSavedTaskViewInput = z.infer<typeof createSavedTaskViewInputSchema>;

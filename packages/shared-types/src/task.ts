import { z } from "zod";

export const taskStatusSchema = z.enum(["todo", "in_progress", "done"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  description: z.string(),
  status: taskStatusSchema,
  dueAt: z.string().nullable(),
  projectTag: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Task = z.infer<typeof taskSchema>;

export const createTaskInputSchema = z.object({
  title: z.string().min(1, "Заголовок обязателен").max(200),
  description: z.string().max(20_000).default(""),
  dueAt: z.string().datetime().nullable().optional(),
  projectTag: z.string().max(60).nullable().optional()
});
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

export const updateTaskInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  status: taskStatusSchema.optional(),
  dueAt: z.string().datetime().nullable().optional(),
  projectTag: z.string().max(60).nullable().optional()
});
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

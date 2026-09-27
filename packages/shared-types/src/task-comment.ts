import { z } from "zod";

/**
 * ORION S17 «Комментарии и журнал задач». A comment's body is user text,
 * rendered client-side through the same `renderMarkdown` (markdown-it,
 * `html: false`) safe path as note bodies (packages/ui/src/markdown.tsx) —
 * no raw HTML is ever interpreted, so there is no separate sanitizer to
 * maintain or forget.
 *
 * `userId`/`authorName` describe the author at read time, joined from
 * `User` (a global identity, not a `WorkspaceMember` one) — a comment stays
 * fully attributed even after the author is removed from this workspace's
 * membership, see schema.prisma's TaskComment doc comment.
 */
export const taskCommentSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  taskId: z.string(),
  userId: z.string(),
  authorName: z.string(),
  /** True when `userId` is the caller's own id — gates the edit/delete UI. */
  mine: z.boolean(),
  body: z.string(),
  editedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type TaskComment = z.infer<typeof taskCommentSchema>;

/**
 * Cursor page, newest-first at the API, oldest-first is a client-side
 * concern (the panel reverses `items` for display) — mirrors
 * `TimeEntryPage` (S15): `nextCursor` is the last row's id to pass back as
 * `cursor`, or `null` when there is no more.
 */
export const taskCommentPageSchema = z.object({
  items: z.array(taskCommentSchema),
  nextCursor: z.string().nullable()
});
export type TaskCommentPage = z.infer<typeof taskCommentPageSchema>;

/** No `userId` field — the server always stamps the author from the authenticated session (see TaskCommentsService.create). */
export const createTaskCommentInputSchema = z.object({
  body: z.string().min(1, "Комментарий не может быть пустым").max(10_000)
});
export type CreateTaskCommentInput = z.infer<typeof createTaskCommentInputSchema>;

export const updateTaskCommentInputSchema = z.object({
  body: z.string().min(1, "Комментарий не может быть пустым").max(10_000)
});
export type UpdateTaskCommentInput = z.infer<typeof updateTaskCommentInputSchema>;

/**
 * Audit trail entry for a status/assignee/due change — append-only, no
 * create/update input schema exists because users never write these rows
 * directly; `TasksService.update` produces them as a side effect of a task
 * edit (see tasks.service.ts).
 */
export const taskActivityFieldSchema = z.enum(["status", "assigneeId", "dueAt"]);
export type TaskActivityField = z.infer<typeof taskActivityFieldSchema>;

export const taskActivitySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  taskId: z.string(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  field: taskActivityFieldSchema,
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  createdAt: z.string()
});
export type TaskActivity = z.infer<typeof taskActivitySchema>;

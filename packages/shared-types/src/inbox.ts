import { z } from "zod";

export const inboxKindSchema = z.enum(["inbox", "task", "note", "event"]);
export type InboxKind = z.infer<typeof inboxKindSchema>;

export const inboxItemSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  body: z.string(),
  kind: inboxKindSchema,
  dueAt: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  projectId: z.string().nullable(),
  processedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type InboxItem = z.infer<typeof inboxItemSchema>;

export const captureInboxInputSchema = z.object({
  title: z.string().trim().min(1, "Введите текст").max(500),
  body: z.string().max(20_000).default(""),
  kind: inboxKindSchema.default("inbox"),
  dueAt: z.string().datetime().nullable().optional(),
  projectId: z.string().nullable().optional()
});
export type CaptureInboxInput = z.infer<typeof captureInboxInputSchema>;

/**
 * List response — S15: the server always caps at `limit` rows (250 active /
 * 100 history), so the response must say the real `totalCount` rather than
 * let the client mistake "250 rows came back" for "there are 250 total".
 * `items.length < totalCount` is the client's signal to show "показаны
 * первые N из M".
 */
export const inboxListSchema = z.object({
  items: z.array(inboxItemSchema),
  totalCount: z.number().int(),
  limit: z.number().int()
});
export type InboxList = z.infer<typeof inboxListSchema>;

export const processInboxInputSchema = z.object({
  kind: z.enum(["task", "note", "event"]),
  dueAt: z.string().datetime().nullable().optional(),
  projectId: z.string().nullable().optional()
});
export type ProcessInboxInput = z.infer<typeof processInboxInputSchema>;

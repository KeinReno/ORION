import { z } from "zod";

export const noteSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Note = z.infer<typeof noteSchema>;

export const createNoteInputSchema = z.object({
  title: z.string().min(1, "Заголовок обязателен").max(200),
  body: z.string().max(20_000).default("")
});
export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;

export const updateNoteInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(20_000).optional()
});
export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;

import { z } from "zod";
export const draftSchema = z.object({
  kind: z.enum(["task", "note"]), id: z.string().uuid().nullable(),
  title: z.string().max(200), body: z.string().max(20_000),
  priority: z.enum(["low", "normal", "high"]),
  lastDictationId: z.string().uuid().optional(),
  expectedRevision: z.number().int().min(1).optional(),
});
export type Draft = z.infer<typeof draftSchema>;

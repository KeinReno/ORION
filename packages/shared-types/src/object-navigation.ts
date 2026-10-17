import { z } from "zod";
import { searchableEntityTypeSchema } from "./search";

/** Navigation addresses refer to existing records; they never grant access. */
export const objectRefSchema = z.object({
  workspaceId: z.string().uuid(),
  entityType: searchableEntityTypeSchema,
  entityId: z.string().uuid()
}).strict();
export type ObjectRef = z.infer<typeof objectRefSchema>;

/** v1 addresses a registered view. View-state persistence is a separate contract. */
export const viewRefSchema = z.object({
  object: objectRefSchema,
  viewId: z.string().min(1).max(64)
}).strict();
export type ViewRef = z.infer<typeof viewRefSchema>;
export type ObjectOpenMode = "tab" | "beside" | "window";

import { z } from "zod";
import { taskStatusSchema, validateOpFields } from "@orion/shared-types";
export const draftSchema = z.object({
  kind: z.enum(["task", "note"]), id: z.string().uuid().nullable(),
  title: z.string().max(200), body: z.string().max(20_000),
  priority: z.enum(["low", "normal", "high"]),
  status: taskStatusSchema.optional(), dueAt: z.string().datetime().nullable().optional(),
  summary: z.string().max(300).optional(), tagsText: z.string().max(2000).optional(),
  pinnedAt: z.string().datetime().nullable().optional(),
  lastDictationId: z.string().uuid().optional(),
  expectedRevision: z.number().int().min(1).optional(),
});
export type Draft = z.infer<typeof draftSchema>;

// Optional fields are omitted for legacy drafts: editing must not erase unknown metadata.
export function entryFields(input: Draft): Record<string, unknown> {
  const draft = draftSchema.parse(input);
  const fields: Record<string, unknown> = draft.kind === "task"
    ? { title: draft.title.trim(), description: draft.body, priority: draft.priority,
      ...(draft.status !== undefined ? { status: draft.status } : {}), ...(draft.dueAt !== undefined ? { dueAt: draft.dueAt } : {}) }
    : { title: draft.title.trim(), body: draft.body,
      ...(draft.summary !== undefined ? { summary: draft.summary } : {}),
      ...(draft.tagsText !== undefined ? { tags: [...new Set(draft.tagsText.split(",").map((tag) => tag.trim()).filter(Boolean))] } : {}),
      ...(draft.pinnedAt !== undefined ? { pinnedAt: draft.pinnedAt } : {}) };
  if (draft.kind === "note" && Array.isArray(fields.tags) && (fields.tags.length > 20 || fields.tags.some((tag) => String(tag).length > 40)))
    throw new Error("Не больше 20 тегов, каждый до 40 символов. Разделяйте теги запятыми.");
  const invalid = validateOpFields(draft.kind, draft.id ? "patch" : "create", fields);
  if (invalid) throw new Error(invalid);
  return fields;
}

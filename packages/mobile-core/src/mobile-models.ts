import { z } from "zod";
import { taskStatusSchema, validateOpFields } from "@orion/shared-types";
/** Checklist steps typed before a task exists; they become child tasks on save. */
export const draftChecklistItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(200),
  done: z.boolean().default(false),
});
export type DraftChecklistItem = z.infer<typeof draftChecklistItemSchema>;
export const MAX_DRAFT_CHECKLIST_ITEMS = 200;
export const draftSchema = z.object({
  kind: z.enum(["task", "note"]), id: z.string().uuid().nullable(),
  title: z.string().max(200), body: z.string().max(20_000),
  priority: z.enum(["low", "normal", "high"]),
  status: taskStatusSchema.optional(), dueAt: z.string().datetime().nullable().optional(),
  startAt: z.string().datetime().nullable().optional(), estimatedMinutesText: z.string().max(32).optional(),
  summary: z.string().max(300).optional(), tagsText: z.string().max(2000).optional(),
  pinnedAt: z.string().datetime().nullable().optional(),
  lastDictationId: z.string().uuid().optional(),
  expectedRevision: z.number().int().min(1).optional(),
  checklist: z.array(draftChecklistItemSchema).max(MAX_DRAFT_CHECKLIST_ITEMS).optional(),
});
export type Draft = z.infer<typeof draftSchema>;

/** Drops blank staged rows and validates titles before anything is durably written. */
export function pendingChecklistItems(items: readonly DraftChecklistItem[] | undefined): DraftChecklistItem[] {
  const pending = (items ?? []).map((item) => ({ ...item, title: item.title.trim() })).filter((item) => item.title);
  for (const item of pending) {
    if (item.title.length > 200) throw new Error("Название пункта длиннее 200 символов.");
  }
  return pending;
}

// Optional fields are omitted for legacy drafts: editing must not erase unknown metadata.
export function entryFields(input: Draft): Record<string, unknown> {
  const draft = draftSchema.parse(input);
  let estimatedMinutes: number | null | undefined;
  if (draft.kind === "task" && draft.estimatedMinutesText !== undefined) {
    const text = draft.estimatedMinutesText.trim();
    if (text && (!/^\d+$/.test(text) || Number(text) > 10_000_000)) throw new Error("Плановое время: целое число минут от 0 до 10 000 000.");
    estimatedMinutes = text ? Number(text) : null;
  }
  const fields: Record<string, unknown> = draft.kind === "task"
    ? { title: draft.title.trim(), description: draft.body, priority: draft.priority,
      ...(draft.startAt !== undefined ? { startAt: draft.startAt } : {}), ...(estimatedMinutes !== undefined ? { estimatedMinutes } : {}),
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

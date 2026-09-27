import { z } from "zod";

/**
 * ORION «Списки» — lightweight checklists (shopping, to-dos). Deliberately
 * separate from Task: no status, no due date, no recurrence — a list is just
 * a name and a set of checkable items. Standalone like Habit (no projectId,
 * no optional module dependencies).
 *
 * Unlike Habit/HabitEntry (kept as two flat, independently-windowed
 * collections — a habit's tick history can be large), a list's items are
 * few and always shown together with their list, so `listSchema` nests
 * `items` directly rather than exposing a second flat endpoint.
 */

export const listItemSchema = z.object({
  id: z.string(),
  listId: z.string(),
  label: z.string(),
  checked: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ListItem = z.infer<typeof listItemSchema>;

export const listSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  /** Non-null = archived (hidden from the active view, items kept). */
  archivedAt: z.string().nullable(),
  items: z.array(listItemSchema),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type List = z.infer<typeof listSchema>;

export const createListInputSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(120)
});
export type CreateListInput = z.infer<typeof createListInputSchema>;

export const updateListInputSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(120).optional(),
  /** `null` restores an archived list — same convention as Habit. */
  archivedAt: z.string().nullable().optional()
});
export type UpdateListInput = z.infer<typeof updateListInputSchema>;

export const createListItemInputSchema = z.object({
  label: z.string().trim().min(1, "Текст обязателен").max(500)
});
export type CreateListItemInput = z.infer<typeof createListItemInputSchema>;

export const updateListItemInputSchema = z.object({
  label: z.string().trim().min(1, "Текст обязателен").max(500).optional(),
  checked: z.boolean().optional()
});
export type UpdateListItemInput = z.infer<typeof updateListItemInputSchema>;

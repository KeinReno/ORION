import { z } from "zod";

/**
 * ORION «Списки» — lightweight checklists (shopping, to-dos, packing). Deliberately
 * separate from Task: no status, no recurrence — a list is a name, a kind and a set of
 * checkable entries (each may carry a quantity, a note, a "by when", a group and a price,
 * but none of that makes it a task). Standalone like Habit (no projectId, no optional
 * module dependencies); bridges to Inventory / Finance / Tasks live in plugins or in the
 * client, never in this module.
 *
 * Unlike Habit/HabitEntry (kept as two flat, independently-windowed
 * collections — a habit's tick history can be large), a list's items are
 * few and always shown together with their list, so `listSchema` nests
 * `items` directly rather than exposing a second flat endpoint.
 */

/** Closed set of list kinds. Stored as text, so adding one never needs a migration. */
export const LIST_KINDS = ["general", "shopping", "todo", "packing"] as const;
export const listKindSchema = z.enum(LIST_KINDS);
export type ListKind = z.infer<typeof listKindSchema>;

export const LIST_KIND_LABELS: Record<ListKind, string> = {
  general: "Список",
  shopping: "Покупки",
  todo: "Дела",
  packing: "Сборы"
};

export const LIST_ITEMS_MAX = 500;
export const LIST_BULK_MAX = 200;

export const listItemSchema = z.object({
  id: z.string(),
  listId: z.string(),
  label: z.string(),
  checked: z.boolean(),
  /** Manual order inside the list (ascending). */
  sortOrder: z.number().int(),
  /** Plugin «Покупки → Склад»: the stock item a purchase of this entry restocks (null = plain entry). */
  inventoryItemId: z.string().nullable(),
  /** Units of the entry; for a stock-linked entry this is also what a purchase adds to stock. */
  quantity: z.number().int(),
  /** Measure shown next to the quantity («л», «кг»); null = none. */
  unit: z.string().nullable(),
  note: z.string(),
  /** A light «by when» (not a task deadline: no overdue alarms). */
  dueAt: z.string().nullable(),
  /** Group header inside the list; null = ungrouped. */
  section: z.string().nullable(),
  /** Price of the whole line in minor units; null = unknown (never read as 0). */
  priceMinor: z.number().int().nullable(),
  /** A purchase already created its stock receipt — buying it again never restocks twice. */
  stocked: z.boolean(),
  /** Plugin «Покупки → Финансы»: the expense this entry was booked as (null = not booked). */
  expenseTransactionId: z.string().nullable(),
  checkedAt: z.string().nullable(),
  checkedById: z.string().nullable(),
  /** Display name of whoever ticked it (null when unticked or the person is gone). */
  checkedByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ListItem = z.infer<typeof listItemSchema>;

export const listSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  kind: listKindSchema,
  /** A template is only ever copied — it is shown on its own tab, never among the active lists. */
  isTemplate: z.boolean(),
  sortOrder: z.number().int(),
  /** Non-null = archived (hidden from the active view, items kept). */
  archivedAt: z.string().nullable(),
  items: z.array(listItemSchema),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type List = z.infer<typeof listSchema>;

const listNameSchema = z.string().trim().min(1, "Название обязательно").max(120);
const itemLabelSchema = z.string().trim().min(1, "Текст обязателен").max(500);
const quantitySchema = z.number().int().min(1, "Количество — от 1").max(100_000);
const unitSchema = z.string().trim().min(1).max(20);
const noteSchema = z.string().max(2000);
const sectionSchema = z.string().trim().min(1).max(60);
const priceSchema = z.number().int().min(0).max(2_000_000_000);

export const createListInputSchema = z.object({
  name: listNameSchema,
  /** Omitted = the template's kind when copying one, otherwise "general". */
  kind: listKindSchema.optional(),
  /** Module «Дом»: attach to this home on creation (the home must be in the same workspace). */
  homeId: z.string().nullable().optional(),
  /** Start as a copy of this list (typically a template): same entries, all unticked. */
  templateId: z.string().nullable().optional()
});
export type CreateListInput = z.infer<typeof createListInputSchema>;

export const updateListInputSchema = z.object({
  name: listNameSchema.optional(),
  kind: listKindSchema.optional(),
  isTemplate: z.boolean().optional(),
  /** `null` restores an archived list — same convention as Habit. */
  archivedAt: z.string().nullable().optional()
});
export type UpdateListInput = z.infer<typeof updateListInputSchema>;

export const createListItemInputSchema = z.object({
  label: itemLabelSchema,
  /** Already ticked (pasted `[x]` lines, imports); ticked by the caller, now. */
  checked: z.boolean().optional(),
  quantity: quantitySchema.optional(),
  unit: unitSchema.nullable().optional(),
  note: noteSchema.optional(),
  dueAt: z.string().datetime().nullable().optional(),
  section: sectionSchema.nullable().optional(),
  priceMinor: priceSchema.nullable().optional()
});
export type CreateListItemInput = z.infer<typeof createListItemInputSchema>;

export const updateListItemInputSchema = z.object({
  label: itemLabelSchema.optional(),
  checked: z.boolean().optional(),
  quantity: quantitySchema.optional(),
  unit: unitSchema.nullable().optional(),
  note: noteSchema.optional(),
  dueAt: z.string().datetime().nullable().optional(),
  section: sectionSchema.nullable().optional(),
  priceMinor: priceSchema.nullable().optional()
});
export type UpdateListItemInput = z.infer<typeof updateListItemInputSchema>;

/** Several entries at once (pasted text, a recipe, a template) — one request, one transaction. */
export const createListItemsBulkInputSchema = z.object({
  items: z.array(createListItemInputSchema).min(1, "Нечего добавлять").max(LIST_BULK_MAX)
});
export type CreateListItemsBulkInput = z.infer<typeof createListItemsBulkInputSchema>;

/** The new manual order: ids from first to last. Unknown ids are rejected, omitted ones keep their relative place after. */
export const reorderInputSchema = z.object({
  ids: z.array(z.string()).min(1).max(LIST_ITEMS_MAX)
});
export type ReorderInput = z.infer<typeof reorderInputSchema>;

export const duplicateListInputSchema = z.object({
  name: listNameSchema.optional(),
  /** Make the copy a template (e.g. «save as template»). */
  asTemplate: z.boolean().optional(),
  /** Keep ticks in the copy; the default is a clean, unticked copy. */
  keepChecked: z.boolean().optional()
});
export type DuplicateListInput = z.infer<typeof duplicateListInputSchema>;

/**
 * Everything a deleted entry carried, so "undo" can put it back whole — not just its text.
 * A re-created-from-text entry would lose its stock link and could restock twice.
 */
export const listItemSnapshotSchema = z.object({
  id: z.string(),
  label: z.string(),
  checked: z.boolean(),
  sortOrder: z.number().int(),
  quantity: z.number().int(),
  unit: z.string().nullable(),
  note: z.string(),
  dueAt: z.string().nullable(),
  section: z.string().nullable(),
  priceMinor: z.number().int().nullable(),
  inventoryItemId: z.string().nullable(),
  stockedMovementId: z.string().nullable(),
  expenseTransactionId: z.string().nullable(),
  checkedAt: z.string().nullable(),
  checkedById: z.string().nullable()
});
export type ListItemSnapshot = z.infer<typeof listItemSnapshotSchema>;

export const clearCheckedResultSchema = z.object({ removed: z.array(listItemSnapshotSchema) });
export type ClearCheckedResult = z.infer<typeof clearCheckedResultSchema>;

export const restoreListItemsInputSchema = z.object({
  items: z.array(listItemSnapshotSchema).min(1).max(LIST_ITEMS_MAX)
});
export type RestoreListItemsInput = z.infer<typeof restoreListItemsInputSchema>;

// ─── Pure helpers (shared by the panel, the dashboard card and tests) ───────────────────────

/** Common units; a trailing/leading number is read as a quantity only next to one of these (or a separator). */
const UNIT_PATTERN = "(?:шт|штук[аи]?|л|литр(?:а|ов)?|мл|кг|г|гр|уп|упак|пач|пачк[аи]|бут|бутылк[аи]|пак|пакет(?:а|ов)?)";

/**
 * One pasted line → an entry. Strips list markers (`-`, `•`, `[ ]`, `[x]`, `1.`) and reads a quantity:
 * `Молоко, 2 л` · `Молоко 2 л` · `2 л молока` · `Яйца x10` · `3 х яблоки` · `Хлеб, 2`.
 * A bare number at the end of a plain phrase (`iPhone 15`) stays part of the text.
 * `checked` is true for a `[x]` marker so a copied checklist round-trips.
 */
export function parseListLine(line: string): { label: string; quantity?: number; unit?: string; checked: boolean } | null {
  let text = line.trim();
  if (/^[-*•–]$/.test(text)) return null;
  let checked = false;
  const box = /^(?:[-*•–]\s*)?\[( |x|X|х|Х)\]\s*/.exec(text);
  if (box) {
    checked = box[1] !== " ";
    text = text.slice(box[0].length);
  } else {
    text = text.replace(/^(?:[-*•–]|\d{1,3}[.)])\s+/, "");
  }
  text = text.trim();
  if (!text) return null;

  const unitOf = (raw: string | undefined): string | undefined => {
    if (!raw) return undefined;
    const u = raw.toLowerCase();
    if (u.startsWith("литр")) return "л";
    if (u.startsWith("штук")) return "шт";
    if (u === "гр") return "г";
    if (u.startsWith("пачк")) return "пач";
    if (u.startsWith("бутылк")) return "бут";
    if (u.startsWith("пакет")) return "пак";
    if (u === "упак") return "уп";
    return u;
  };
  const intIn = (raw: string): number | null => {
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : null;
  };

  // «2 л молока» / «3 х яблоки» / «3× яблоки»
  let m = new RegExp(`^(\\d+)\\s*(${UNIT_PATTERN})\\.?\\s+(.+)$`, "i").exec(text);
  if (m && intIn(m[1]!) !== null) return { label: m[3]!.trim(), quantity: intIn(m[1]!)!, unit: unitOf(m[2]), checked };
  m = /^(\d+)\s*[x×хХ]\s*(.+)$/i.exec(text);
  if (m && intIn(m[1]!) !== null) return { label: m[2]!.trim(), quantity: intIn(m[1]!)!, checked };
  // «Молоко, 2 л» / «Молоко 2 л» / «Яйца x10» / «Хлеб, 2»
  m = new RegExp(`^(.+?)\\s*,\\s*(\\d+)\\s*(${UNIT_PATTERN})?\\.?$`, "i").exec(text);
  if (m && intIn(m[2]!) !== null) return { label: m[1]!.trim(), quantity: intIn(m[2]!)!, unit: unitOf(m[3]), checked };
  m = new RegExp(`^(.+?)\\s+(\\d+)\\s*(${UNIT_PATTERN})\\.?$`, "i").exec(text);
  if (m && intIn(m[2]!) !== null) return { label: m[1]!.trim(), quantity: intIn(m[2]!)!, unit: unitOf(m[3]), checked };
  m = /^(.+?)\s+[x×хХ]\s*(\d+)$/i.exec(text);
  if (m && intIn(m[2]!) !== null) return { label: m[1]!.trim(), quantity: intIn(m[2]!)!, checked };
  return { label: text, checked };
}

export interface ParsedListEntry {
  label: string;
  quantity?: number;
  unit?: string;
  section?: string;
  checked: boolean;
}

/**
 * Pasted multi-line text → entries (blank lines skipped, capped at `LIST_BULK_MAX`). A line starting
 * with `#` opens a group: the entries below it get that `section` (`# Овощи`).
 */
export function parseListText(text: string): ParsedListEntry[] {
  const entries: ParsedListEntry[] = [];
  let section: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const heading = /^\s*#+\s*(.+?)\s*$/.exec(raw);
    if (heading) {
      section = heading[1]!.slice(0, 60);
      continue;
    }
    const entry = parseListLine(raw);
    if (entry) entries.push(section ? { ...entry, section } : entry);
    if (entries.length >= LIST_BULK_MAX) break;
  }
  return entries;
}

/** «2 л», «×3», or "" for a plain single entry. */
export function formatListQuantity(item: Pick<ListItem, "quantity" | "unit">): string {
  if (item.unit) return `${item.quantity} ${item.unit}`;
  return item.quantity > 1 ? `×${item.quantity}` : "";
}

export interface ListProgress {
  total: number;
  checked: number;
  open: number;
  /** Sum of known prices, minor units. */
  priceMinor: number;
  /** Open entries whose price is unknown — the sum above does not include them (null ≠ 0). */
  unpriced: number;
}

export function listProgress(items: readonly Pick<ListItem, "checked" | "priceMinor">[]): ListProgress {
  let checked = 0;
  let priceMinor = 0;
  let unpriced = 0;
  for (const item of items) {
    if (item.checked) checked += 1;
    if (item.priceMinor === null) unpriced += 1;
    else priceMinor += item.priceMinor;
  }
  return { total: items.length, checked, open: items.length - checked, priceMinor, unpriced };
}

/** Manual order, unticked before ticked inside the same group (a display order; nothing persisted). */
export function sortListItems<T extends Pick<ListItem, "checked" | "sortOrder" | "createdAt">>(items: readonly T[], uncheckedFirst = true): T[] {
  return [...items].sort(
    (a, b) =>
      (uncheckedFirst ? Number(a.checked) - Number(b.checked) : 0) ||
      a.sortOrder - b.sortOrder ||
      a.createdAt.localeCompare(b.createdAt)
  );
}

export interface ListSection<T> {
  /** null = entries without a group. */
  section: string | null;
  items: T[];
}

/**
 * Groups entries by `section` in order of first appearance of each group in the manual order;
 * ungrouped entries come first. Entry order inside a group is preserved.
 */
export function groupListItems<T extends Pick<ListItem, "section">>(items: readonly T[]): ListSection<T>[] {
  const groups = new Map<string | null, T[]>();
  for (const item of items) {
    const key = item.section ?? null;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  const result: ListSection<T>[] = [];
  const loose = groups.get(null);
  if (loose) result.push({ section: null, items: loose });
  for (const [section, bucket] of groups) if (section !== null) result.push({ section, items: bucket });
  return result;
}

/** Plain text of a list that `parseListText` reads back (`[ ]` / `[x]` markers, `, 2 л`, `# группа`). */
export function formatListAsText(list: { name: string; items: readonly Pick<ListItem, "checked" | "sortOrder" | "createdAt" | "section" | "label" | "quantity" | "unit">[] }): string {
  const lines: string[] = [list.name];
  for (const group of groupListItems(sortListItems(list.items, false))) {
    if (group.section) lines.push("", `# ${group.section}`);
    for (const item of group.items) {
      const amount = formatListQuantity(item);
      lines.push(`${item.checked ? "[x]" : "[ ]"} ${item.label}${amount ? `, ${item.unit ? amount : item.quantity}` : ""}`.trimEnd());
    }
  }
  return lines.join("\n");
}

/** New `sortOrder` for dropping an entry at `index` among `others` (already ordered, without the moved one). */
export function reorderedIds(ids: readonly string[], movedId: string, toIndex: number): string[] {
  const without = ids.filter((id) => id !== movedId);
  const at = Math.max(0, Math.min(toIndex, without.length));
  return [...without.slice(0, at), movedId, ...without.slice(at)];
}

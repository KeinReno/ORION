import { z } from "zod";
import { applyOpLocally, emptyEntities } from "@orion/core";
import { listSchema, LIST_ITEMS_MAX, normalizeOpFields, validateOpFields, type List, type SyncOp } from "@orion/shared-types";
export const mobileListDraftSchema = z.object({ kind: z.enum(["list", "item"]), id: z.string().uuid(), parentId: z.string().uuid().nullable(), text: z.string().max(500) });
export type MobileListDraft = z.infer<typeof mobileListDraftSchema>;
export interface MobileListMutation { entity: "list" | "listItem"; kind: "create" | "patch" | "delete"; id: string; parentId?: string; fields?: Record<string, unknown> }
export function prepareListMutation(lists: readonly List[], mutation: MobileListMutation) {
  const parent = mutation.entity === "listItem" ? lists.find((list) => list.id === mutation.parentId) : undefined;
  const existing = mutation.entity === "list" ? lists.find((list) => list.id === mutation.id) : parent?.items.find((item) => item.id === mutation.id);
  if (mutation.entity === "listItem" && !parent) throw new Error("Список не найден. Вернитесь к спискам.");
  if (mutation.entity === "listItem" && parent?.isTemplate) throw new Error("Сначала создайте список из шаблона на компьютере.");
  if (mutation.entity === "list" && existing && "isTemplate" in existing && existing.isTemplate) throw new Error("Шаблон доступен только для просмотра на телефоне.");
  if (mutation.kind !== "create" && !existing) throw new Error("Запись списка не найдена. Обновите раздел.");
  if (mutation.kind === "create" && existing) throw new Error("Запись уже существует. Откройте её для изменения.");
  if (mutation.kind === "create" && parent && parent.items.length >= LIST_ITEMS_MAX) throw new Error("В списке уже 500 пунктов.");
  const fields = normalizeOpFields(mutation.entity, mutation.fields);
  const invalid = validateOpFields(mutation.entity, mutation.kind, fields);
  if (invalid) throw new Error(invalid);
  return { entity: mutation.entity, entityId: mutation.id, kind: mutation.kind, ...(mutation.parentId ? { parentId: mutation.parentId } : {}), ...(mutation.kind === "delete" ? {} : { fields }) };
}
export function projectMobileListOp(lists: readonly List[], op: SyncOp, workspaceId: string): List[] {
  const entities = emptyEntities();
  for (const list of lists) {
    const { items, ...record } = list;
    entities.list[list.id] = record;
    for (const item of items) entities.listItem[item.id] = { ...item };
  }
  applyOpLocally(entities, op, { userId: "local-device", workspaceId, userName: null });
  const compare = (a: { sortOrder: number; createdAt: string; id: string }, b: { sortOrder: number; createdAt: string; id: string }) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  return Object.values(entities.list).map((list) => listSchema.parse({ ...list, items: Object.values(entities.listItem).filter((item) => item.listId === list.id) }))
    .map((list) => ({ ...list, items: list.items.sort(compare) })).sort(compare);
}

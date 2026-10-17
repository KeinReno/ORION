"use client";

import type {
  ClearCheckedResult,
  CreateListInput,
  CreateListItemInput,
  CreateListItemsBulkInput,
  DuplicateListInput,
  List,
  ListItem,
  ReorderInput,
  RestoreListItemsInput,
  UpdateListInput,
  UpdateListItemInput
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient, type QueryKey, type UseQueryResult } from "@tanstack/react-query";
import { useCore } from "./provider";
import { fromReplica, useHybridReplica, type HybridReplica } from "./use-replica";

/**
 * How often a visible list is re-read. Lists are shared by everyone in the workspace (a family
 * shopping list is ticked from several phones), so a change made elsewhere must show up without a
 * reload; the poll pauses in a background tab and a refocus refetches immediately.
 */
export const LISTS_POLL_MS = 15_000;

/**
 * Lists of a workspace, each with its items nested — unlike habits/entries,
 * a list's items are few and always shown together with it, so there is no
 * separate flat endpoint/cache to keep in sync. Templates are a separate set
 * (`useListTemplates`); they never mix into the active view.
 */
export function useLists(workspaceId: string | undefined, includeArchived = false) {
  const { api } = useCore();
  const replica = useHybridReplica(workspaceId);
  const query = useQuery<List[]>({
    queryKey: ["lists", workspaceId, includeArchived],
    queryFn: () => api.listLists(workspaceId as string, { includeArchived }),
    enabled: Boolean(workspaceId) && !replica,
    refetchInterval: LISTS_POLL_MS
  });
  if (replica) {
    const data = replica.engine.lists().lists.filter((list) => !list.isTemplate && (includeArchived || !list.archivedAt));
    return fromReplica(query, replica, data);
  }
  return query;
}


export function useListTemplates(workspaceId: string | undefined, enabled = true) {
  const { api } = useCore();
  const replica = useHybridReplica(workspaceId);
  const query = useQuery<List[]>({
    queryKey: ["lists", workspaceId, "templates"],
    queryFn: () => api.listLists(workspaceId as string, { templates: true, includeArchived: true }),
    enabled: Boolean(workspaceId) && enabled && !replica
  });
  if (replica) return fromReplica(query, replica, replica.engine.lists().lists.filter((list) => list.isTemplate));
  return query;
}

/** One list in any state — what a list's own tab or window opens. */
export function useList(workspaceId: string | undefined, listId: string | undefined) {
  const { api } = useCore();
  const replica = useHybridReplica(workspaceId);
  const query = useQuery<List>({
    queryKey: ["lists", workspaceId, "one", listId],
    queryFn: () => api.getList(workspaceId as string, listId as string),
    enabled: Boolean(workspaceId && listId) && !replica,
    refetchInterval: LISTS_POLL_MS
  });
  if (replica) {
    const found = replica.engine.lists().lists.find((list) => list.id === listId);
    if (found) return fromReplica(query, replica, found);
    // Копия загружена, а списка в ней нет — это «не найден», а не вечная загрузка.
    if (replica.engine.hasCopy()) {
      return { ...fromReplica(query, replica, undefined as never), isError: true, isSuccess: false, status: "error", error: new Error("Список не найден") } as UseQueryResult<List>;
    }
    return fromReplica(query, replica, undefined as never);
  }
  return query;
}

function useInvalidateLists(workspaceId: string | undefined): () => void {
  const queryClient = useQueryClient();
  const replica = useHybridReplica(workspaceId);
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["lists", workspaceId] });
    // Операции, которым нужен узел (дубликат, «новый круг»…), меняют данные там — подтягиваем в копию.
    if (replica) void replica.engine.sync();
  };
}

/** Постановка операции в очередь копии + немедленная попытка отправки (офлайн она просто останется в очереди). */
async function enqueueAndKick(
  replica: HybridReplica,
  input: Parameters<HybridReplica["engine"]["enqueue"]>[0]
): Promise<{ entityId: string }> {
  const op = await replica.engine.enqueue(input);
  void replica.engine.sync();
  return { entityId: op.entityId };
}

function defined<T extends Record<string, unknown>>(fields: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function nextItemOrder(replica: HybridReplica, listId: string): number {
  const list = replica.engine.lists().lists.find((entry) => entry.id === listId);
  return (list?.items.reduce((max, item) => Math.max(max, item.sortOrder), 0) ?? 0) + 10;
}

/** Cached values are either a list of lists or one list (see the keys above); a patch has to handle both. */
type ListsCache = List[] | List | undefined;

function patchCache(cache: ListsCache, listId: string, patch: (list: List) => List): ListsCache {
  if (!cache) return cache;
  if (Array.isArray(cache)) return cache.map((list) => (list.id === listId ? patch(list) : list));
  return cache.id === listId ? patch(cache) : cache;
}

type Snapshot = [QueryKey, ListsCache][];

/** Applies `patch` to `listId` in every cached shape and returns what it replaced, for rollback. */
async function optimistic(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string | undefined,
  listId: string,
  patch: (list: List) => List
): Promise<Snapshot> {
  await queryClient.cancelQueries({ queryKey: ["lists", workspaceId] });
  const snapshot = queryClient.getQueriesData<ListsCache>({ queryKey: ["lists", workspaceId] });
  queryClient.setQueriesData<ListsCache>({ queryKey: ["lists", workspaceId] }, (cache) => patchCache(cache, listId, patch));
  return snapshot;
}

function rollback(queryClient: ReturnType<typeof useQueryClient>, snapshot: Snapshot | undefined): void {
  for (const [queryKey, data] of snapshot ?? []) queryClient.setQueryData(queryKey, data);
}

export function useCreateList(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  const replica = useHybridReplica(workspaceId);
  return useMutation<List, Error, CreateListInput>({
    // Гибрид: запись идёт в локальную очередь и без сети — react-query не должен приостанавливать её до появления связи.
    networkMode: replica ? "always" : "online",
    mutationFn: async (input: CreateListInput) => {
      // Копия из шаблона / привязка к дому требуют узла — идут обычным запросом.
      if (replica && !input.templateId && !input.homeId) {
        const lists = replica.engine.lists().lists;
        const { entityId } = await enqueueAndKick(replica, {
          entity: "list",
          kind: "create",
          fields: { name: input.name, ...(input.kind ? { kind: input.kind } : {}), sortOrder: lists.reduce((max, l) => Math.max(max, l.sortOrder), 0) + 10 }
        });
        return replica.engine.lists().lists.find((list) => list.id === entityId) as List;
      }
      return api.createList(workspaceId as string, input);
    },
    onSuccess: invalidate
  });
}

export function useUpdateList(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  const replica = useHybridReplica(workspaceId);
  return useMutation<List, Error, { listId: string; input: UpdateListInput }>({
    // Гибрид: запись идёт в локальную очередь и без сети — react-query не должен приостанавливать её до появления связи.
    networkMode: replica ? "always" : "online",
    mutationFn: async ({ listId, input }) => {
      if (replica && input.isTemplate === undefined) {
        await enqueueAndKick(replica, { entity: "list", kind: "patch", entityId: listId, fields: defined({ name: input.name, kind: input.kind, archivedAt: input.archivedAt }) });
        return replica.engine.lists().lists.find((list) => list.id === listId) as List;
      }
      return api.updateList(workspaceId as string, listId, input);
    },
    onSuccess: invalidate
  });
}

/** `DELETE` archives the list; its items stay and `useUpdateList` with `{ archivedAt: null }` brings it back. */
export function useArchiveList(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  const replica = useHybridReplica(workspaceId);
  return useMutation<List, Error, string>({
    // Гибрид: запись идёт в локальную очередь и без сети — react-query не должен приостанавливать её до появления связи.
    networkMode: replica ? "always" : "online",
    mutationFn: async (listId: string) => {
      if (replica) {
        await enqueueAndKick(replica, { entity: "list", kind: "patch", entityId: listId, fields: { archivedAt: new Date().toISOString() } });
        return replica.engine.lists().lists.find((list) => list.id === listId) as List;
      }
      return api.archiveList(workspaceId as string, listId);
    },
    onSuccess: invalidate
  });
}

/** Real deletion — only an archived list or a template; the server refuses anything else. */
export function useDeleteListPermanently(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  const replica = useHybridReplica(workspaceId);
  return useMutation<void, Error, string>({
    // Гибрид: запись идёт в локальную очередь и без сети — react-query не должен приостанавливать её до появления связи.
    networkMode: replica ? "always" : "online",
    mutationFn: async (listId: string) => {
      if (replica) {
        await enqueueAndKick(replica, { entity: "list", kind: "delete", entityId: listId });
        return;
      }
      return api.deleteListPermanently(workspaceId as string, listId);
    },
    onSuccess: invalidate
  });
}

/** Manual order of the lists: the board re-sorts at once, then the server confirms. */
export function useReorderLists(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateLists(workspaceId);
  return useMutation<void, Error, ReorderInput, Snapshot>({
    mutationFn: (input) => api.reorderLists(workspaceId as string, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["lists", workspaceId] });
      const snapshot = queryClient.getQueriesData<ListsCache>({ queryKey: ["lists", workspaceId] });
      const rank = new Map(input.ids.map((id, index) => [id, (index + 1) * 10]));
      queryClient.setQueriesData<ListsCache>({ queryKey: ["lists", workspaceId] }, (cache) => {
        if (!Array.isArray(cache)) return cache;
        return cache
          .map((list) => (rank.has(list.id) ? { ...list, sortOrder: rank.get(list.id) as number } : list))
          .sort((a, b) => a.sortOrder - b.sortOrder);
      });
      return snapshot;
    },
    onError: (_error, _vars, snapshot) => rollback(queryClient, snapshot),
    onSettled: invalidate
  });
}

export function useDuplicateList(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  return useMutation<List, Error, { listId: string; input?: DuplicateListInput }>({
    mutationFn: ({ listId, input }) => api.duplicateList(workspaceId as string, listId, input ?? {}),
    onSuccess: invalidate
  });
}

/** «Новый круг» — unticks every entry of a reusable list. */
export function useResetList(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  return useMutation<List, Error, string>({
    mutationFn: (listId: string) => api.resetList(workspaceId as string, listId),
    onSuccess: invalidate
  });
}

export function useCreateListItem(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  const replica = useHybridReplica(workspaceId);
  return useMutation<ListItem, Error, { listId: string; input: CreateListItemInput }>({
    // Гибрид: запись идёт в локальную очередь и без сети — react-query не должен приостанавливать её до появления связи.
    networkMode: replica ? "always" : "online",
    mutationFn: async ({ listId, input }) => {
      if (replica) {
        const { entityId } = await enqueueAndKick(replica, {
          entity: "listItem",
          kind: "create",
          parentId: listId,
          fields: { ...defined({ ...input }), sortOrder: nextItemOrder(replica, listId) }
        });
        const list = replica.engine.lists().lists.find((entry) => entry.id === listId);
        return list?.items.find((item) => item.id === entityId) as ListItem;
      }
      return api.createListItem(workspaceId as string, listId, input);
    },
    onSuccess: invalidate
  });
}

export function useCreateListItemsBulk(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  const replica = useHybridReplica(workspaceId);
  return useMutation<ListItem[], Error, { listId: string; input: CreateListItemsBulkInput }>({
    // Гибрид: запись идёт в локальную очередь и без сети — react-query не должен приостанавливать её до появления связи.
    networkMode: replica ? "always" : "online",
    mutationFn: async ({ listId, input }) => {
      if (replica) {
        const ids: string[] = [];
        let order = nextItemOrder(replica, listId);
        for (const entry of input.items) {
          const { entityId } = await enqueueAndKick(replica, { entity: "listItem", kind: "create", parentId: listId, fields: { ...defined({ ...entry }), sortOrder: order } });
          ids.push(entityId);
          order += 10;
        }
        const list = replica.engine.lists().lists.find((l) => l.id === listId);
        return (list?.items ?? []).filter((item) => ids.includes(item.id));
      }
      return api.createListItemsBulk(workspaceId as string, listId, input);
    },
    onSuccess: invalidate
  });
}

export interface UpdateListItemVars {
  listId: string;
  itemId: string;
  input: UpdateListItemInput;
}

/**
 * Also drives the checkbox, which has to answer instantly — patches the item
 * inside its list's cached `items` array before the request resolves and
 * rolls back on error, same shape as `useToggleHabit`'s optimism but over one
 * cache instead of two (items live nested in `lists`, not a flat sibling).
 */
export function useUpdateListItem(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateLists(workspaceId);
  const replica = useHybridReplica(workspaceId);

  return useMutation<ListItem, Error, UpdateListItemVars, Snapshot>({
    // Гибрид: запись идёт в локальную очередь и без сети — react-query не должен приостанавливать её до появления связи.
    networkMode: replica ? "always" : "online",
    mutationFn: async ({ listId, itemId, input }) => {
      if (replica) {
        await enqueueAndKick(replica, { entity: "listItem", kind: "patch", entityId: itemId, parentId: listId, fields: defined({ ...input }) });
        const list = replica.engine.lists().lists.find((entry) => entry.id === listId);
        return list?.items.find((item) => item.id === itemId) as ListItem;
      }
      return api.updateListItem(workspaceId as string, listId, itemId, input);
    },
    onMutate: ({ listId, itemId, input }) =>
      optimistic(queryClient, workspaceId, listId, (list) => ({
        ...list,
        items: list.items.map((item) => {
          if (item.id !== itemId) return item;
          // Only the fields the user can see change at once; `checkedBy*` waits for the server's answer.
          const { checked, label, quantity, unit, note, dueAt, section, priceMinor } = input;
          return {
            ...item,
            ...(checked !== undefined ? { checked } : {}),
            ...(label !== undefined ? { label } : {}),
            ...(quantity !== undefined ? { quantity } : {}),
            ...(unit !== undefined ? { unit } : {}),
            ...(note !== undefined ? { note } : {}),
            ...(dueAt !== undefined ? { dueAt } : {}),
            ...(section !== undefined ? { section } : {}),
            ...(priceMinor !== undefined ? { priceMinor } : {})
          };
        })
      })),
    onError: (_error, _vars, snapshot) => rollback(queryClient, snapshot),
    onSettled: invalidate
  });
}

export function useDeleteListItem(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  const replica = useHybridReplica(workspaceId);
  return useMutation<void, Error, { listId: string; itemId: string }>({
    // Гибрид: запись идёт в локальную очередь и без сети — react-query не должен приостанавливать её до появления связи.
    networkMode: replica ? "always" : "online",
    mutationFn: async ({ listId, itemId }) => {
      if (replica) {
        await enqueueAndKick(replica, { entity: "listItem", kind: "delete", entityId: itemId, parentId: listId });
        return;
      }
      return api.deleteListItem(workspaceId as string, listId, itemId);
    },
    onSuccess: invalidate
  });
}

/** Manual order of one list's entries — drag-and-drop answers at once, rolls back if the server refuses. */
export function useReorderListItems(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateLists(workspaceId);
  return useMutation<List, Error, { listId: string; input: ReorderInput; section?: { itemId: string; section: string | null } }, Snapshot>({
    mutationFn: async ({ listId, input, section }) => {
      // Moving an entry into another group is a field change; do it first so the order lands in the new group.
      if (section) await api.updateListItem(workspaceId as string, listId, section.itemId, { section: section.section });
      return api.reorderListItems(workspaceId as string, listId, input);
    },
    onMutate: ({ listId, input, section }) =>
      optimistic(queryClient, workspaceId, listId, (list) => {
        const rank = new Map(input.ids.map((id, index) => [id, (index + 1) * 10]));
        return {
          ...list,
          items: list.items
            .map((item) => ({
              ...item,
              ...(rank.has(item.id) ? { sortOrder: rank.get(item.id) as number } : {}),
              ...(section && item.id === section.itemId ? { section: section.section } : {})
            }))
            .sort((a, b) => a.sortOrder - b.sortOrder)
        };
      }),
    onError: (_error, _vars, snapshot) => rollback(queryClient, snapshot),
    onSettled: invalidate
  });
}

/** Deletes every checked item at once; the result carries them whole for `useRestoreListItems`. */
export function useClearCheckedItems(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  return useMutation<ClearCheckedResult, Error, string>({
    mutationFn: (listId: string) => api.clearCheckedItems(workspaceId as string, listId),
    onSuccess: invalidate
  });
}

export function useRestoreListItems(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  return useMutation<List, Error, { listId: string; input: RestoreListItemsInput }>({
    mutationFn: ({ listId, input }) => api.restoreListItems(workspaceId as string, listId, input),
    onSuccess: invalidate
  });
}

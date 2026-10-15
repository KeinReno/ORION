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
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCore } from "./provider";

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
  return useQuery<List[]>({
    queryKey: ["lists", workspaceId, includeArchived],
    queryFn: () => api.listLists(workspaceId as string, { includeArchived }),
    enabled: Boolean(workspaceId),
    refetchInterval: LISTS_POLL_MS
  });
}

export function useListTemplates(workspaceId: string | undefined, enabled = true) {
  const { api } = useCore();
  return useQuery<List[]>({
    queryKey: ["lists", workspaceId, "templates"],
    queryFn: () => api.listLists(workspaceId as string, { templates: true, includeArchived: true }),
    enabled: Boolean(workspaceId) && enabled
  });
}

/** One list in any state — what a list's own tab or window opens. */
export function useList(workspaceId: string | undefined, listId: string | undefined) {
  const { api } = useCore();
  return useQuery<List>({
    queryKey: ["lists", workspaceId, "one", listId],
    queryFn: () => api.getList(workspaceId as string, listId as string),
    enabled: Boolean(workspaceId && listId),
    refetchInterval: LISTS_POLL_MS
  });
}

function useInvalidateLists(workspaceId: string | undefined): () => void {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ["lists", workspaceId] });
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
  return useMutation<List, Error, CreateListInput>({
    mutationFn: (input: CreateListInput) => api.createList(workspaceId as string, input),
    onSuccess: invalidate
  });
}

export function useUpdateList(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  return useMutation<List, Error, { listId: string; input: UpdateListInput }>({
    mutationFn: ({ listId, input }) => api.updateList(workspaceId as string, listId, input),
    onSuccess: invalidate
  });
}

/** `DELETE` archives the list; its items stay and `useUpdateList` with `{ archivedAt: null }` brings it back. */
export function useArchiveList(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  return useMutation<List, Error, string>({
    mutationFn: (listId: string) => api.archiveList(workspaceId as string, listId),
    onSuccess: invalidate
  });
}

/** Real deletion — only an archived list or a template; the server refuses anything else. */
export function useDeleteListPermanently(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  return useMutation<void, Error, string>({
    mutationFn: (listId: string) => api.deleteListPermanently(workspaceId as string, listId),
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
  return useMutation<ListItem, Error, { listId: string; input: CreateListItemInput }>({
    mutationFn: ({ listId, input }) => api.createListItem(workspaceId as string, listId, input),
    onSuccess: invalidate
  });
}

export function useCreateListItemsBulk(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  return useMutation<ListItem[], Error, { listId: string; input: CreateListItemsBulkInput }>({
    mutationFn: ({ listId, input }) => api.createListItemsBulk(workspaceId as string, listId, input),
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

  return useMutation<ListItem, Error, UpdateListItemVars, Snapshot>({
    mutationFn: ({ listId, itemId, input }) => api.updateListItem(workspaceId as string, listId, itemId, input),
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
  return useMutation<void, Error, { listId: string; itemId: string }>({
    mutationFn: ({ listId, itemId }) => api.deleteListItem(workspaceId as string, listId, itemId),
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

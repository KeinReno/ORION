"use client";

import type {
  CreateListInput,
  CreateListItemInput,
  List,
  ListItem,
  UpdateListInput,
  UpdateListItemInput
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * Lists of a workspace, each with its items nested — unlike habits/entries,
 * a list's items are few and always shown together with it, so there is no
 * separate flat endpoint/cache to keep in sync.
 */
export function useLists(workspaceId: string | undefined, includeArchived = false) {
  const { api } = useCore();
  return useQuery<List[]>({
    queryKey: ["lists", workspaceId, includeArchived],
    queryFn: () => api.listLists(workspaceId as string, includeArchived),
    enabled: Boolean(workspaceId)
  });
}

function useInvalidateLists(workspaceId: string | undefined): () => void {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ["lists", workspaceId] });
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

export function useCreateListItem(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  return useMutation<ListItem, Error, { listId: string; input: CreateListItemInput }>({
    mutationFn: ({ listId, input }) => api.createListItem(workspaceId as string, listId, input),
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

  return useMutation<ListItem, Error, UpdateListItemVars, [QueryKey, List[] | undefined][]>({
    mutationFn: ({ listId, itemId, input }) => api.updateListItem(workspaceId as string, listId, itemId, input),
    onMutate: async ({ listId, itemId, input }) => {
      await queryClient.cancelQueries({ queryKey: ["lists", workspaceId] });
      const snapshot = queryClient.getQueriesData<List[]>({ queryKey: ["lists", workspaceId] });
      queryClient.setQueriesData<List[]>({ queryKey: ["lists", workspaceId] }, (lists) =>
        lists?.map((list) =>
          list.id !== listId
            ? list
            : { ...list, items: list.items.map((item) => (item.id === itemId ? { ...item, ...input } : item)) }
        )
      );
      return snapshot;
    },
    onError: (_error, _vars, snapshot) => {
      for (const [queryKey, data] of snapshot ?? []) queryClient.setQueryData(queryKey, data);
    },
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

/** Deletes every checked item in the list at once — the "clear completed" action. */
export function useClearCheckedItems(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateLists(workspaceId);
  return useMutation<void, Error, string>({
    mutationFn: (listId: string) => api.clearCheckedItems(workspaceId as string, listId),
    onSuccess: invalidate
  });
}

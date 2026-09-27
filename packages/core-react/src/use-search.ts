"use client";

import type {
  CreateAndLinkInput,
  CreateAndLinkResult,
  CreateEntityLinkInput,
  CreateEntityReminderInput,
  EntityLinkPage,
  EntityReminder,
  GlobalSearchResult,
  SearchableEntityType
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * Server-side global search (v0.14) — the one search that isn't a client-side
 * filter over an already-loaded list. It has to be server-side: it spans six
 * modules (projects, tasks, notes, events, documents, transactions) and reads
 * `Document.extractedText`, none of which the client ever holds in full.
 *
 * Call with a *debounced* query: every distinct string is its own cache entry
 * and its own request (same convention as `useNotes`'s `search`).
 */
export function useGlobalSearch(workspaceId: string | undefined, query: string) {
  const { api } = useCore();
  const trimmed = query.trim();
  return useQuery<GlobalSearchResult[]>({
    queryKey: ["search", workspaceId, trimmed],
    queryFn: () => api.search(workspaceId as string, trimmed),
    // One or two letters match most of the workspace — not worth a round trip.
    enabled: Boolean(workspaceId) && trimmed.length >= 2,
    staleTime: 30_000
  });
}

/**
 * First page of typed links attached to one entity ("связанные записи"), read
 * by type + id — cursor-paginated at the API (U01), mirrors `useTaskComments`
 * (S17): the panel shows a bounded set of links, not an infinite list, so
 * further pages are a manual `api.listEntityLinks(..., cursor)` call, not an
 * infinite-scroll hook.
 */
export function useEntityLinks(workspaceId: string | undefined, type: SearchableEntityType, id: string | undefined) {
  const { api } = useCore();
  return useQuery<EntityLinkPage>({
    queryKey: ["links", workspaceId, type, id],
    queryFn: () => api.listEntityLinks(workspaceId as string, type, id as string),
    enabled: Boolean(workspaceId && id)
  });
}

export function useCreateEntityLink(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEntityLinkInput) => api.createEntityLink(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["links", workspaceId] })
  });
}

/**
 * U03 Часть 1: create a task/note AND link it to a target entity in one
 * atomic server request (`SearchService.createAndLink`) — invalidates the
 * new entity's own list (`tasks`/`notes`) alongside `links`, since both a
 * new row and a new link were created server-side.
 */
export function useCreateAndLink(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAndLinkInput) => api.createAndLink(workspaceId as string, input),
    onSuccess: (result: CreateAndLinkResult) => {
      void queryClient.invalidateQueries({ queryKey: ["links", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: [result.entityType === "task" ? "tasks" : "notes", workspaceId] });
    }
  });
}

export function useDeleteEntityLink(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => api.deleteEntityLink(workspaceId as string, linkId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["links", workspaceId] })
  });
}

/** U03: this user's own personal one-shot reminders in this workspace. */
export function useReminders(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<EntityReminder[]>({
    queryKey: ["reminders", workspaceId],
    queryFn: () => api.listReminders(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateReminder(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEntityReminderInput) => api.createReminder(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reminders", workspaceId] })
  });
}

export function useCancelReminder(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reminderId: string) => api.cancelReminder(workspaceId as string, reminderId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reminders", workspaceId] })
  });
}

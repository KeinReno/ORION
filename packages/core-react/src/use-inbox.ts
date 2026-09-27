"use client";

import type { CaptureInboxInput, InboxItem, InboxList, ProcessInboxInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * The inbox has exactly two slices and they share one endpoint: `history`
 * false is "still to be processed" (the queue the panel opens on), true is
 * everything already turned into a task/note/event. Each slice is its own
 * cached query, same as `useNotes` does for active/trash.
 *
 * The server caps the response (S15) — `data.items` may be fewer rows than
 * `data.totalCount`. Consumers must show `totalCount`, not `items.length`,
 * anywhere they'd otherwise imply the visible rows are the whole inbox.
 */
export function useInbox(workspaceId: string | undefined, history = false) {
  const { api } = useCore();
  return useQuery<InboxList>({
    queryKey: ["inbox", workspaceId, history],
    queryFn: () => api.listInbox(workspaceId as string, history),
    enabled: Boolean(workspaceId)
  });
}

export function useCaptureInboxItem(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<InboxItem, Error, CaptureInboxInput>({
    mutationFn: (input: CaptureInboxInput) => api.captureInboxItem(workspaceId as string, input),
    // Both slices change at once when an item is captured (it leaves the
    // queue and, once processed, shows up in the history), so invalidate the
    // whole `["inbox"]` prefix rather than one slice.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inbox"] })
  });
}

/**
 * Processing is a cross-module write: the item leaves the queue **and** a
 * task/note/event appears in its own panel. So this is the one mutation that
 * has to invalidate three roots — otherwise the new entity exists but the
 * panel that should show it keeps serving a stale list.
 */
export function useProcessInboxItem(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<InboxItem, Error, { itemId: string; input: ProcessInboxInput }>({
    mutationFn: ({ itemId, input }: { itemId: string; input: ProcessInboxInput }) =>
      api.processInboxItem(workspaceId as string, itemId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["notes"] });
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    }
  });
}

export function useDeleteInboxItem(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (itemId: string) => api.deleteInboxItem(workspaceId as string, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inbox"] })
  });
}

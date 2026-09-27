"use client";

import type { CalendarConnection, CalendarConnectionInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * Inbound calendar subscriptions (v0.14): a remote ICS/CalDAV feed imported
 * read-only into the calendar. The mirror image of the *outbound* feed
 * (`useCalendarFeed` / `useRotateCalendarFeed`) — that one publishes ORION's
 * own events as a token URL, this one pulls someone else's.
 */
export function useCalendarConnections(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<CalendarConnection[]>({
    queryKey: ["calendar-connections", workspaceId],
    queryFn: () => api.listCalendarConnections(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateCalendarConnection(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CalendarConnectionInput) => api.createCalendarConnection(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["calendar-connections", workspaceId] })
  });
}

export function useUpdateCalendarConnection(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CalendarConnectionInput }) =>
      api.updateCalendarConnection(workspaceId as string, id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["calendar-connections", workspaceId] })
  });
}

/** Pulls the feed now (the backend also syncs on its own schedule) and refreshes the events already on screen. */
export function useSyncCalendarConnection(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.syncCalendarConnection(workspaceId as string, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["calendar-connections", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["events", workspaceId] });
    }
  });
}

export function useDeleteCalendarConnection(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCalendarConnection(workspaceId as string, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["calendar-connections", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["events", workspaceId] });
    }
  });
}

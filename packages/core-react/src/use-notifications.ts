"use client";

import type { Notification } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * In-app notification centre (v0.14) — the list behind the bell, not the
 * `notifications/check-due` cron trigger. Notifications are "live" in the
 * sense that a due-task check can add one while the app is open, but they
 * are not chat: 30s of staleness is invisible in practice, and a 60s
 * refetch keeps the badge honest without hammering the API every render.
 */
const NOTIFICATIONS_STALE_TIME = 30_000;
const NOTIFICATIONS_REFETCH_INTERVAL = 60_000;

/**
 * `unreadOnly` maps straight onto the server's `?unread=true` filter, so a
 * caller that only needs the badge can skip the read rows. Every mutation
 * below invalidates the whole `["notifications"]` prefix, so the filtered
 * and unfiltered views never disagree.
 */
export function useNotifications(workspaceId: string | undefined, unreadOnly = false) {
  const { api } = useCore();
  return useQuery<Notification[]>({
    queryKey: ["notifications", workspaceId, unreadOnly],
    queryFn: () => api.listNotifications(workspaceId as string, unreadOnly),
    enabled: Boolean(workspaceId),
    staleTime: NOTIFICATIONS_STALE_TIME,
    refetchInterval: NOTIFICATIONS_REFETCH_INTERVAL
  });
}

/** `read: false` puts a notification back to unread — the same call, two directions. */
export function useMarkNotificationRead(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<Notification, Error, { notificationId: string; read: boolean }>({
    mutationFn: ({ notificationId, read }) => api.markNotificationRead(workspaceId as string, notificationId, read),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });
}

/** Returns `{ updated }` — how many rows actually flipped, for the toast. */
export function useMarkAllNotificationsRead(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<{ updated: number }, Error, void>({
    mutationFn: () => api.markAllNotificationsRead(workspaceId as string),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });
}

export function useDeleteNotification(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (notificationId: string) => api.deleteNotification(workspaceId as string, notificationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });
}

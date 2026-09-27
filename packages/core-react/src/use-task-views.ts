"use client";

import type { CreateSavedTaskViewInput, SavedTaskView } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * Saved task views (v0.14) — named filter presets for the tasks board.
 * Workspace-scoped and stored server-side, so a view survives a reload and
 * follows the user to another device (unlike the dock layout, which is
 * localStorage-only by design).
 */
export function useTaskViews(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<SavedTaskView[]>({
    queryKey: ["task-views", workspaceId],
    queryFn: () => api.listTaskViews(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateTaskView(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSavedTaskViewInput) => api.createTaskView(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task-views", workspaceId] })
  });
}

export function useDeleteTaskView(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (viewId: string) => api.deleteTaskView(workspaceId as string, viewId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task-views", workspaceId] })
  });
}

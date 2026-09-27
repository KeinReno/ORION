"use client";

import type { CreateTaskInput, Task, UpdateTaskInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * `search` (optional) switches to the server's full-text query instead of
 * the plain list (see TasksService.list) — pass a debounced value, since
 * each distinct string is its own cached query and fires its own request.
 */
export function useTasks(workspaceId: string | undefined, search?: string, assignedToMe?: boolean) {
  const { api } = useCore();
  return useQuery<Task[]>({
    queryKey: ["tasks", workspaceId, search ?? "", assignedToMe ?? false],
    queryFn: () => api.listTasks(workspaceId as string, search, assignedToMe),
    enabled: Boolean(workspaceId),
    refetchInterval: 60_000
  });
}

export function useCreateTask(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => api.createTask(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] })
  });
}

export function useUpdateTask(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: UpdateTaskInput }) =>
      api.updateTask(workspaceId as string, taskId, input),
    onSuccess: (_task, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] });
      if (vars.input.status !== undefined) {
        void queryClient.invalidateQueries({ queryKey: ["time-running", workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ["time", workspaceId] });
      }
    }
  });
}

export function useDeleteTask(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.deleteTask(workspaceId as string, taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] })
  });
}

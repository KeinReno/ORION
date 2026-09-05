"use client";

import type { CreateTaskInput, Task, UpdateTaskInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useTasks(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<Task[]>({
    queryKey: ["tasks", workspaceId],
    queryFn: () => api.listTasks(workspaceId as string),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] })
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

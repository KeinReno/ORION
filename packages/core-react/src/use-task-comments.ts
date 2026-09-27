"use client";

import type { CreateTaskCommentInput, TaskActivity, TaskCommentPage, UpdateTaskCommentInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * First page of comments for a task — S17. Plain REST + react-query refetch,
 * no websockets/presence (explicitly out of scope, see 10-BACKLOG.md S17).
 * Further pages are a manual "load more" via `api.listTaskComments(...,
 * { cursor })` — the panel is expected to be a short mini-thread, not an
 * infinite chat log, so no infinite-scroll hook is built here.
 */
export function useTaskComments(workspaceId: string | undefined, taskId: string | undefined) {
  const { api } = useCore();
  return useQuery<TaskCommentPage>({
    queryKey: ["task-comments", workspaceId, taskId],
    queryFn: () => api.listTaskComments(workspaceId as string, taskId as string),
    enabled: Boolean(workspaceId && taskId)
  });
}

export function useCreateTaskComment(workspaceId: string | undefined, taskId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskCommentInput) => api.createTaskComment(workspaceId as string, taskId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task-comments", workspaceId, taskId] })
  });
}

export function useUpdateTaskComment(workspaceId: string | undefined, taskId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, input }: { commentId: string; input: UpdateTaskCommentInput }) =>
      api.updateTaskComment(workspaceId as string, taskId as string, commentId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task-comments", workspaceId, taskId] })
  });
}

export function useDeleteTaskComment(workspaceId: string | undefined, taskId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => api.deleteTaskComment(workspaceId as string, taskId as string, commentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task-comments", workspaceId, taskId] })
  });
}

export function useTaskActivity(workspaceId: string | undefined, taskId: string | undefined) {
  const { api } = useCore();
  return useQuery<TaskActivity[]>({
    queryKey: ["task-activity", workspaceId, taskId],
    queryFn: () => api.listTaskActivity(workspaceId as string, taskId as string),
    enabled: Boolean(workspaceId && taskId)
  });
}

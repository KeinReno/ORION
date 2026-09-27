"use client";

import type { CreateSavingsGoalInput, SavingsGoal, UpdateSavingsGoalInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useGoals(workspaceId: string | undefined, includeArchived = false) {
  const { api } = useCore();
  return useQuery<SavingsGoal[]>({
    queryKey: ["finance-goals", workspaceId, includeArchived],
    queryFn: () => api.listGoals(workspaceId as string, includeArchived),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateGoal(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSavingsGoalInput) => api.createGoal(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-goals", workspaceId] })
  });
}

export function useUpdateGoal(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, input }: { goalId: string; input: UpdateSavingsGoalInput }) =>
      api.updateGoal(workspaceId as string, goalId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-goals", workspaceId] })
  });
}

export function useDeleteGoal(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goalId: string) => api.deleteGoal(workspaceId as string, goalId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-goals", workspaceId] })
  });
}

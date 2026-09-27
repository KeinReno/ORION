"use client";

import type { Budget, CreateBudgetInput, UpdateBudgetInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useBudgets(workspaceId: string | undefined, month?: string) {
  const { api } = useCore();
  return useQuery<Budget[]>({
    queryKey: ["finance-budgets", workspaceId, month ?? ""],
    queryFn: () => api.listBudgets(workspaceId as string, month),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateBudget(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBudgetInput) => api.createBudget(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-budgets", workspaceId] })
  });
}

export function useUpdateBudget(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ budgetId, input }: { budgetId: string; input: UpdateBudgetInput }) =>
      api.updateBudget(workspaceId as string, budgetId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-budgets", workspaceId] })
  });
}

export function useDeleteBudget(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (budgetId: string) => api.deleteBudget(workspaceId as string, budgetId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-budgets", workspaceId] })
  });
}

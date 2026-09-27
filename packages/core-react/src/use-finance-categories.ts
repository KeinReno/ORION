"use client";

import type { CreateFinanceCategoryInput, FinanceCategory, UpdateFinanceCategoryInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useFinanceCategories(workspaceId: string | undefined, includeArchived = false) {
  const { api } = useCore();
  return useQuery<FinanceCategory[]>({
    queryKey: ["finance-categories", workspaceId, includeArchived],
    queryFn: () => api.listFinanceCategories(workspaceId as string, includeArchived),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateFinanceCategory(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFinanceCategoryInput) => api.createFinanceCategory(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-categories", workspaceId] })
  });
}

export function useUpdateFinanceCategory(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, input }: { categoryId: string; input: UpdateFinanceCategoryInput }) =>
      api.updateFinanceCategory(workspaceId as string, categoryId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-categories", workspaceId] })
  });
}

export function useDeleteFinanceCategory(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => api.deleteFinanceCategory(workspaceId as string, categoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-categories", workspaceId] });
      // Deleting a category cascades its budgets and nulls it out on transactions server-side.
      queryClient.invalidateQueries({ queryKey: ["finance-transactions", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["finance-budgets", workspaceId] });
    }
  });
}

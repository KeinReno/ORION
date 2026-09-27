"use client";

import type { CategoryRule, CreateCategoryRuleInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useCategoryRules(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<CategoryRule[]>({
    queryKey: ["finance-category-rules", workspaceId],
    queryFn: () => api.listCategoryRules(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateCategoryRule(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryRuleInput) => api.createCategoryRule(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-category-rules", workspaceId] })
  });
}

export function useDeleteCategoryRule(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: string) => api.deleteCategoryRule(workspaceId as string, ruleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-category-rules", workspaceId] })
  });
}

"use client";

import type { CreateFinanceTemplateInput, FinanceTemplate, UpdateFinanceTemplateInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useFinanceTemplates(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<FinanceTemplate[]>({
    queryKey: ["finance-templates", workspaceId],
    queryFn: () => api.listFinanceTemplates(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateFinanceTemplate(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFinanceTemplateInput) => api.createFinanceTemplate(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-templates", workspaceId] })
  });
}

export function useUpdateFinanceTemplate(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, input }: { templateId: string; input: UpdateFinanceTemplateInput }) =>
      api.updateFinanceTemplate(workspaceId as string, templateId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-templates", workspaceId] })
  });
}

export function useDeleteFinanceTemplate(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => api.deleteFinanceTemplate(workspaceId as string, templateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-templates", workspaceId] })
  });
}

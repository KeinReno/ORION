"use client";

import type { CreateRecurringTransactionInput, RecurringTransaction, UpdateRecurringTransactionInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useRecurringTransactions(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<RecurringTransaction[]>({
    queryKey: ["finance-recurring", workspaceId],
    queryFn: () => api.listRecurringTransactions(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateRecurringTransaction(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRecurringTransactionInput) => api.createRecurringTransaction(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-recurring", workspaceId] })
  });
}

export function useUpdateRecurringTransaction(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ recurringId, input }: { recurringId: string; input: UpdateRecurringTransactionInput }) =>
      api.updateRecurringTransaction(workspaceId as string, recurringId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-recurring", workspaceId] })
  });
}

export function useDeleteRecurringTransaction(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recurringId: string) => api.deleteRecurringTransaction(workspaceId as string, recurringId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-recurring", workspaceId] })
  });
}

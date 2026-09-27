"use client";

import type { CreateTransactionInput, Transaction, UpdateTransactionInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export interface TransactionFilters {
  accountId?: string;
  categoryId?: string;
  tag?: string;
  /** "YYYY-MM". Ignored if `from`/`to` is given. */
  month?: string;
  /** ISO datetimes — an arbitrary range, takes priority over `month`. */
  from?: string;
  to?: string;
  /** Default 50 on the server. */
  limit?: number;
  offset?: number;
}

export function useTransactions(workspaceId: string | undefined, filters?: TransactionFilters) {
  const { api } = useCore();
  return useQuery<Transaction[]>({
    queryKey: ["finance-transactions", workspaceId, filters ?? {}],
    queryFn: () => api.listTransactions(workspaceId as string, filters),
    enabled: Boolean(workspaceId)
  });
}

/**
 * A transaction changes its account's balance, (if categorised) its
 * category's budget "spent", and the reports built from the same lines —
 * invalidate all of them alongside the list itself.
 */
function invalidateTransactionEffects(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string | undefined): void {
  queryClient.invalidateQueries({ queryKey: ["finance-transactions", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["finance-accounts", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["finance-goals", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["finance-budgets", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["finance-reports-monthly", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["finance-reports-categories", workspaceId] });
}

export function useCreateTransaction(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTransactionInput) => api.createTransaction(workspaceId as string, input),
    onSuccess: () => invalidateTransactionEffects(queryClient, workspaceId)
  });
}

export function useUpdateTransaction(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ transactionId, input }: { transactionId: string; input: UpdateTransactionInput }) =>
      api.updateTransaction(workspaceId as string, transactionId, input),
    onSuccess: () => invalidateTransactionEffects(queryClient, workspaceId)
  });
}

export function useDeleteTransaction(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (transactionId: string) => api.deleteTransaction(workspaceId as string, transactionId),
    onSuccess: () => invalidateTransactionEffects(queryClient, workspaceId)
  });
}

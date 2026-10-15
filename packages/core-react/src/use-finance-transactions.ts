"use client";

import type { CreateTransactionInput, FinanceImportInput, MergeTransferInput, FinanceImportResult, Transaction, UpdateTransactionInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export interface TransactionFilters {
  accountId?: string;
  categoryId?: string;
  projectId?: string;
  /** personal | family | work — by the operation's account. */
  context?: string;
  tag?: string;
  /** Substring of the note, case-insensitive. */
  q?: string;
  /** Kopecks; an operation matches when one of its lines is within the range. */
  minAmount?: number;
  maxAmount?: number;
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
  queryClient.invalidateQueries({ queryKey: ["finance-project-costs", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["home-utilities", workspaceId] });
}

/** Replaces a matched expense + income with one transfer; everything a transaction touches is refreshed. */
export function useMergeTransferPair(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<Transaction, Error, MergeTransferInput>({
    mutationFn: (input) => api.mergeTransferPair(workspaceId as string, input),
    onSuccess: () => invalidateTransactionEffects(queryClient, workspaceId)
  });
}

export function useCreateTransaction(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTransactionInput) => api.createTransaction(workspaceId as string, input),
    onSuccess: () => invalidateTransactionEffects(queryClient, workspaceId)
  });
}

/** Dry run or real import of a file's rows; a real run refreshes everything a transaction touches. */
export function useImportTransactions(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<FinanceImportResult, Error, FinanceImportInput>({
    mutationFn: (input) => api.importTransactions(workspaceId as string, input),
    onSuccess: (result) => {
      if (!result.dryRun) invalidateTransactionEffects(queryClient, workspaceId);
    }
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

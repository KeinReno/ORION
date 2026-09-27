"use client";

import type { Account, CreateAccountInput, UpdateAccountInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useAccounts(workspaceId: string | undefined, includeArchived = false) {
  const { api } = useCore();
  return useQuery<Account[]>({
    queryKey: ["finance-accounts", workspaceId, includeArchived],
    queryFn: () => api.listAccounts(workspaceId as string, includeArchived),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateAccount(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAccountInput) => api.createAccount(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-accounts", workspaceId] })
  });
}

export function useUpdateAccount(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, input }: { accountId: string; input: UpdateAccountInput }) =>
      api.updateAccount(workspaceId as string, accountId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-accounts", workspaceId] })
  });
}

export function useDeleteAccount(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => api.deleteAccount(workspaceId as string, accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-accounts", workspaceId] });
      // Deleting an account cascades to its transactions server-side.
      queryClient.invalidateQueries({ queryKey: ["finance-transactions", workspaceId] });
    }
  });
}

export function useReconcileAccount(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, actualBalance }: { accountId: string; actualBalance: number }) =>
      api.reconcileAccount(workspaceId as string, accountId, actualBalance),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-accounts", workspaceId] });
      // A reconciliation may create a corrective transaction — refresh everything it touches.
      queryClient.invalidateQueries({ queryKey: ["finance-transactions", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["finance-goals", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["finance-reports-monthly", workspaceId] });
    }
  });
}

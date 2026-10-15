"use client";

import type { CreateObligationInput, Obligation, PayObligationInput, Transaction, UpdateObligationInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useObligations(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<Obligation[]>({
    queryKey: ["finance-obligations", workspaceId],
    queryFn: () => api.listObligations(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

/** Payments recorded against one obligation (loaded only while the history is open). */
export function useObligationPayments(workspaceId: string | undefined, obligationId: string | undefined) {
  const { api } = useCore();
  return useQuery<Transaction[]>({
    queryKey: ["finance-obligation-payments", workspaceId, obligationId],
    queryFn: () => api.listObligationPayments(workspaceId as string, obligationId as string),
    enabled: Boolean(workspaceId) && Boolean(obligationId)
  });
}

export function useCreateObligation(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateObligationInput) => api.createObligation(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-obligations", workspaceId] })
  });
}

export function useUpdateObligation(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ obligationId, input }: { obligationId: string; input: UpdateObligationInput }) =>
      api.updateObligation(workspaceId as string, obligationId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-obligations", workspaceId] })
  });
}

export function useDeleteObligation(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (obligationId: string) => api.deleteObligation(workspaceId as string, obligationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-obligations", workspaceId] })
  });
}

/** Paying writes a real transaction, so everything a transaction touches is refreshed with the plan. */
export function usePayObligation(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<{ obligation: Obligation; transaction: Transaction }, Error, { obligationId: string; input: PayObligationInput }>({
    mutationFn: ({ obligationId, input }) => api.payObligation(workspaceId as string, obligationId, input),
    onSuccess: () => {
      for (const key of ["finance-obligations", "finance-obligation-payments", "finance-transactions", "finance-accounts", "finance-goals", "finance-budgets", "finance-reports-monthly", "finance-reports-categories"]) {
        queryClient.invalidateQueries({ queryKey: [key, workspaceId] });
      }
    }
  });
}

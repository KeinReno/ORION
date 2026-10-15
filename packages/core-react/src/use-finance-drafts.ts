"use client";

import type { AcceptFinanceDraftInput, FinanceDraft, Transaction } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/** Operations proposed by AI agents (plugin `finance-ai-drafts`): drafts only, a human confirms each one. */
export function useFinanceDrafts(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<FinanceDraft[]>({
    queryKey: ["finance-drafts", workspaceId],
    queryFn: () => api.listFinanceDrafts(workspaceId as string),
    enabled: Boolean(workspaceId),
    // A new draft arrives from outside the app; look again now and then instead of waiting for a reload.
    refetchInterval: 30_000
  });
}

/** Accepting writes a real operation, so everything a transaction touches is refreshed with the draft list. */
export function useAcceptFinanceDraft(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<{ draft: FinanceDraft; transaction: Transaction }, Error, { draftId: string; input: AcceptFinanceDraftInput }>({
    mutationFn: ({ draftId, input }) => api.acceptFinanceDraft(workspaceId as string, draftId, input),
    onSuccess: () => {
      for (const key of ["finance-drafts", "finance-transactions", "finance-accounts", "finance-goals", "finance-budgets", "finance-reports-monthly", "finance-reports-categories", "finance-project-costs"]) {
        queryClient.invalidateQueries({ queryKey: [key, workspaceId] });
      }
    }
  });
}

export function useRejectFinanceDraft(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draftId: string) => api.rejectFinanceDraft(workspaceId as string, draftId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-drafts", workspaceId] })
  });
}

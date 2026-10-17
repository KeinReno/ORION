"use client";

import type { CreateSettlementInput, CreateSplitInput, SplitOverview } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

const KEY = "finance-split";

/** Shared expenses, settlements and the exact «who owes whom» balances (plugin `finance-split`). */
export function useSplitOverview(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<SplitOverview>({
    queryKey: [KEY, workspaceId],
    queryFn: () => api.getSplitOverview(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useSplitActions(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] });
  const createSplit = useMutation({ mutationFn: (input: CreateSplitInput) => api.createSplit(workspaceId as string, input), onSuccess: refresh });
  const deleteSplit = useMutation({ mutationFn: (splitId: string) => api.deleteSplit(workspaceId as string, splitId), onSuccess: refresh });
  const createSettlement = useMutation({ mutationFn: (input: CreateSettlementInput) => api.createSettlement(workspaceId as string, input), onSuccess: refresh });
  const deleteSettlement = useMutation({ mutationFn: (settlementId: string) => api.deleteSettlement(workspaceId as string, settlementId), onSuccess: refresh });
  return { createSplit, deleteSplit, createSettlement, deleteSettlement };
}

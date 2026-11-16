"use client";

import type { UpdateFinanceSettingsInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useFinanceSettings(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery({
    queryKey: ["finance-settings", workspaceId],
    queryFn: () => api.getFinanceSettings(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useUpdateFinanceSettings(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateFinanceSettingsInput) => api.updateFinanceSettings(workspaceId as string, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-settings", workspaceId] });
      // Switching to simple mode may lazily create the default account — refresh accounts too.
      queryClient.invalidateQueries({ queryKey: ["finance-accounts", workspaceId] });
    }
  });
}

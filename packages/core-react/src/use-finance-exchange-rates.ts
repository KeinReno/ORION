"use client";

import type { ExchangeRate, UpsertExchangeRateInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * Hand-entered rates (plugin `finance-exchange-rates`). Safe to ask for when the plugin is off: the server answers 409
 * and the list is simply empty, so a consumer converts nothing instead of failing.
 */
export function useExchangeRates(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<ExchangeRate[]>({
    queryKey: ["finance-exchange-rates", workspaceId],
    queryFn: () => api.listExchangeRates(workspaceId as string).catch(() => [] as ExchangeRate[]),
    enabled: Boolean(workspaceId)
  });
}

export function useSaveExchangeRate(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertExchangeRateInput) => api.saveExchangeRate(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-exchange-rates", workspaceId] })
  });
}

export function useDeleteExchangeRate(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rateId: string) => api.deleteExchangeRate(workspaceId as string, rateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-exchange-rates", workspaceId] })
  });
}

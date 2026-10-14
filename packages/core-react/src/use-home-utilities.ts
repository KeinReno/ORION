"use client";

import type { ElectricityTariffInput, ImportUtilityMonthsInput, PutUtilityMonthInput, PutUtilityPaymentInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useUtilityMonths(workspaceId: string | undefined, homeId: string | undefined) {
  const { api } = useCore();
  return useQuery({
    queryKey: ["home-utilities", workspaceId, homeId, "months"],
    queryFn: () => api.listUtilityMonths(workspaceId as string, homeId as string),
    enabled: Boolean(workspaceId && homeId)
  });
}

export function usePutUtilityMonth(workspaceId: string | undefined, homeId: string) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { period: string; input: PutUtilityMonthInput }) => api.putUtilityMonth(workspaceId as string, homeId, v.period, v.input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["home-utilities", workspaceId, homeId] })
  });
}

export function useImportUtilityMonths(workspaceId: string | undefined, homeId: string) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportUtilityMonthsInput) => api.importUtilityMonths(workspaceId as string, homeId, input),
    onSuccess: (result) => { if (!result.dryRun) queryClient.invalidateQueries({ queryKey: ["home-utilities", workspaceId, homeId] }); }
  });
}

export function usePutUtilityPayment(workspaceId: string | undefined, homeId: string) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { period: string; input: PutUtilityPaymentInput }) => api.putUtilityPayment(workspaceId as string, homeId, v.period, v.input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["home-utilities", workspaceId, homeId] })
  });
}

export function useRemoveUtilityPayment(workspaceId: string | undefined, homeId: string) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { period: string; paymentId: string }) => api.removeUtilityPayment(workspaceId as string, homeId, v.period, v.paymentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["home-utilities", workspaceId, homeId] })
  });
}

export function useCopyPreviousUtilityMonth(workspaceId: string | undefined, homeId: string) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (period: string) => api.copyPreviousUtilityMonth(workspaceId as string, homeId, period),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["home-utilities", workspaceId, homeId] })
  });
}

export function useElectricityTariffs(workspaceId: string | undefined, homeId: string, meterId: string | undefined) {
  const { api } = useCore();
  return useQuery({
    queryKey: ["home-utilities", workspaceId, homeId, "tariffs", meterId],
    queryFn: () => api.listElectricityTariffs(workspaceId as string, homeId, meterId as string),
    enabled: Boolean(workspaceId && homeId && meterId)
  });
}

export function useAddElectricityTariff(workspaceId: string | undefined, homeId: string, meterId: string) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ElectricityTariffInput) => api.addElectricityTariff(workspaceId as string, homeId, meterId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["home-utilities", workspaceId, homeId, "tariffs", meterId] })
  });
}

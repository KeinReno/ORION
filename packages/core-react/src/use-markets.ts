"use client";

import type {
  CompassEngineStatus,
  CompassJournalSyncResult,
  CreateWatchItemInput,
  InvestmentTrade,
  RecordTradeFeeInput,
  TradeImportInput,
  TradeImportResult,
  TradeMode,
  UpdateWatchItemInput,
  WatchItem
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useWatchItems(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<WatchItem[]>({
    queryKey: ["markets-watch", workspaceId],
    queryFn: () => api.listWatchItems(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useAddWatchItem(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWatchItemInput) => api.addWatchItem(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["markets-watch", workspaceId] })
  });
}

export function useUpdateWatchItem(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: UpdateWatchItemInput }) => api.updateWatchItem(workspaceId as string, itemId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["markets-watch", workspaceId] })
  });
}

export function useDeleteWatchItem(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api.deleteWatchItem(workspaceId as string, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["markets-watch", workspaceId] })
  });
}

export function useInvestmentTrades(workspaceId: string | undefined, mode?: TradeMode) {
  const { api } = useCore();
  return useQuery<InvestmentTrade[]>({
    queryKey: ["markets-trades", workspaceId, mode ?? "all"],
    queryFn: () => api.listInvestmentTrades(workspaceId as string, mode),
    enabled: Boolean(workspaceId)
  });
}

export function useImportInvestmentTrades(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<TradeImportResult, Error, TradeImportInput>({
    mutationFn: (input) => api.importInvestmentTrades(workspaceId as string, input),
    onSuccess: (result) => {
      if (!result.dryRun) queryClient.invalidateQueries({ queryKey: ["markets-trades", workspaceId] });
    }
  });
}

/** The fee becomes a real expense, so everything a transaction touches is refreshed with the trade. */
export function useRecordTradeFee(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tradeId, input }: { tradeId: string; input: RecordTradeFeeInput }) => api.recordTradeFee(workspaceId as string, tradeId, input),
    onSuccess: () => {
      for (const key of ["markets-trades", "finance-transactions", "finance-accounts", "finance-goals", "finance-budgets", "finance-reports-monthly", "finance-reports-categories"]) {
        queryClient.invalidateQueries({ queryKey: [key, workspaceId] });
      }
    }
  });
}

export function useDeleteInvestmentTrade(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tradeId: string) => api.deleteInvestmentTrade(workspaceId as string, tradeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["markets-trades", workspaceId] })
  });
}

/** Движок Compass, запущенный ORION: пока он стартует, состояние опрашивается. */
export function useCompassEngine(workspaceId: string | undefined, enabled = true) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const key = ["markets-engine", workspaceId];
  const status = useQuery<CompassEngineStatus>({
    queryKey: key,
    queryFn: () => api.compassEngine(workspaceId as string),
    enabled: Boolean(workspaceId) && enabled,
    refetchInterval: (query) => (query.state.data?.state === "starting" ? 1500 : false)
  });
  const run = useMutation<CompassEngineStatus, Error, "start" | "stop">({
    mutationFn: (action) => api.compassEngine(workspaceId as string, action),
    onSuccess: (next) => queryClient.setQueryData(key, next)
  });
  return { status, run };
}

/** Забрать журнал из работающего Compass в «Сделки» ORION (без файла резервной копии). */
export function useSyncCompassJournal(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<CompassJournalSyncResult, Error, void>({
    mutationFn: () => api.syncCompassJournal(workspaceId as string),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["markets-trades", workspaceId] })
  });
}

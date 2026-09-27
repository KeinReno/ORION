"use client";

import type { CategoryBreakdownEntry, MonthlyFinanceSummary } from "@orion/shared-types";
import { useQuery } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useMonthlyFinanceSummary(workspaceId: string | undefined, months = 6) {
  const { api } = useCore();
  return useQuery<MonthlyFinanceSummary[]>({
    queryKey: ["finance-reports-monthly", workspaceId, months],
    queryFn: () => api.getMonthlyFinanceSummary(workspaceId as string, months),
    enabled: Boolean(workspaceId)
  });
}

export function useCategoryBreakdown(
  workspaceId: string | undefined,
  opts: { month?: string; from?: string; to?: string }
) {
  const { api } = useCore();
  return useQuery<CategoryBreakdownEntry[]>({
    queryKey: ["finance-reports-categories", workspaceId, opts],
    queryFn: () => api.getCategoryBreakdown(workspaceId as string, opts),
    enabled: Boolean(workspaceId) && (Boolean(opts.month) || Boolean(opts.from) || Boolean(opts.to))
  });
}

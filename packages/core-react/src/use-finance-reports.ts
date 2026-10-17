"use client";

import { pickFinanceCurrency, primaryAccountCurrency, type CategoryBreakdownEntry, type MonthlyFinanceSummary } from "@orion/shared-types";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAccounts } from "./use-finance-accounts";
import { useCore } from "./provider";

/**
 * One row per (month, account currency) — a multi-currency workspace gets one
 * series per currency, never a sum across them (see
 * `monthlyFinanceSummarySchema`). Filter by `currency` before charting or
 * adding anything up; `useFinanceCurrency` picks which one to show.
 */
export function useMonthlyFinanceSummary(workspaceId: string | undefined, months = 6) {
  const { api } = useCore();
  return useQuery<MonthlyFinanceSummary[]>({
    queryKey: ["finance-reports-monthly", workspaceId, months],
    queryFn: () => api.getMonthlyFinanceSummary(workspaceId as string, months),
    enabled: Boolean(workspaceId)
  });
}

/** One entry per (category, account currency) — filter by `currency` before adding amounts up. */
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

/**
 * Which of `available` currencies a finance view shows: the one the person
 * switched to, otherwise the workspace's primary currency
 * (`primaryAccountCurrency` — the one most of its live accounts are in),
 * otherwise the first available. `currency` is null only when `available` is
 * empty. A single-currency workspace always gets its only currency, so the
 * view behaves exactly as before; the caller shows a switcher only when
 * `available.length > 1`.
 */
export function useFinanceCurrency(workspaceId: string | undefined, available: readonly string[]) {
  const { data: accounts } = useAccounts(workspaceId, true);
  const preferred = useMemo(() => (accounts ? primaryAccountCurrency(accounts) : null), [accounts]);
  const [picked, setCurrency] = useState<string | null>(null);
  const currency = pickFinanceCurrency(available, picked, preferred);
  return { currency, setCurrency };
}

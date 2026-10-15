"use client";

import type { RecordListExpenseInput, RecordListExpenseResult } from "@orion/shared-types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * Plugin «Покупки → Финансы» (lists-finance). Booking changes both ends: the entries show their
 * «записано» mark and the new expense appears in the finance caches (transactions, balances, budgets).
 */
export function useRecordListExpense(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<RecordListExpenseResult, Error, { listId: string; input: RecordListExpenseInput }>({
    mutationFn: ({ listId, input }) => api.recordListExpense(workspaceId as string, listId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lists", workspaceId] });
      for (const key of ["finance-transactions", "finance-accounts", "finance-budgets", "finance-reports-monthly", "finance-reports-categories"]) {
        void queryClient.invalidateQueries({ queryKey: [key, workspaceId] });
      }
    }
  });
}

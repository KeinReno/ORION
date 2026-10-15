"use client";

import { useAccounts, useMergeTransferPair, useTransactions } from "@orion/core-react";
import { findTransferPairs } from "@orion/shared-types";
import { Button, useToast } from "@orion/ui";
import { ArrowLeftRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { FinanceTransactionsTopSlotProps } from "../../lib/extensions/contracts";
import { describeAuthError, formatMoney, shortDate } from "../../lib/extensions/host-api";

const LOOKBACK_DAYS = 90;
const SAMPLE = 300;

/**
 * Plugin `finance-transfer-match`: «Похоже на перевод». After importing two statements, a transfer between your own
 * accounts is there twice — an expense on one and an income on the other — and both inflate the reports. Only
 * unambiguous pairs are offered (equal amount, different accounts, three days apart, one candidate each way), and
 * nothing happens until the pair is confirmed: the two rows are then replaced by one transfer.
 */
export function TransferMatchBanner({ workspaceId }: FinanceTransactionsTopSlotProps): React.ReactElement | null {
  const since = useMemo(() => new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString(), []);
  const { data: transactions } = useTransactions(workspaceId, { from: since, limit: SAMPLE });
  const { data: accounts } = useAccounts(workspaceId, true);
  const merge = useMergeTransferPair(workspaceId);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pairs = useMemo(() => findTransferPairs(transactions ?? []), [transactions]);
  if (pairs.length === 0) return null;
  const name = (accountId: string): string => accounts?.find((account) => account.id === accountId)?.name ?? "—";

  async function mergePair(expenseId: string, incomeId: string): Promise<void> {
    setBusyId(expenseId);
    try {
      await merge.mutateAsync({ expenseId, incomeId });
      toast({ title: "Объединено в один перевод", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось объединить", description: describeAuthError(error), tone: "danger" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 px-3 py-2">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 text-left text-xs text-foreground" aria-expanded={open}>
        <ArrowLeftRight className="h-4 w-4 shrink-0 text-accent-text" aria-hidden />
        <span className="flex-1">
          Похоже на переводы между вашими счетами: {pairs.length}. Сейчас они считаются и расходом, и доходом.
        </span>
        <span className="text-accent-text">{open ? "Скрыть" : "Показать"}</span>
      </button>
      {open ? (
        <ul className="mt-2 space-y-1.5">
          {pairs.map(({ expense, income }) => (
            <li key={expense.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 text-muted-foreground">
                {shortDate(expense.occurredAt)} · {name(expense.accountId)} → {name(income.accountId)} ·{" "}
                <span className="font-mono tabular-nums text-foreground">{formatMoney(expense.totalAmount)}</span>
              </span>
              <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => void mergePair(expense.id, income.id)}>
                Это перевод
              </Button>
            </li>
          ))}
          <li className="text-2xs text-subtle-foreground">Две операции заменятся одним переводом; связи с другими записями у старых операций пропадут.</li>
        </ul>
      ) : null}
    </div>
  );
}

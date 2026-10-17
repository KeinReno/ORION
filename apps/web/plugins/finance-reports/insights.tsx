"use client";

import { useAccounts, useCategoryBreakdown, useCore, useFinanceCategories, useProjects, useTransactions } from "@orion/core-react";
import { Button, Skeleton, useToast } from "@orion/ui";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { compareBreakdowns, describeAuthError, formatMoney, topPayees, transactionsToCsv, useEnabledModules } from "../../lib/extensions/host-api";

const EXPORT_LIMIT = 5000;
/** Sample the payee list from the month's operations; a month with more than this shows its biggest spenders of the first page. */
const PAYEE_SAMPLE = 500;

function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, index! - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Plugin `finance-reports`, second half: the chosen month against the one before it, where the money went by what the
 * operation says, and the month as a spreadsheet. Numbers come from the same server aggregates as the charts above.
 *
 * Everything here is in the one `currency` the report above is switched to: the comparison takes only that
 * currency's breakdown entries, and payees only the operations of accounts in that currency (archived ones included,
 * their operations are still history) — a RUB+USD workspace never sees one mixed total.
 */
export function ReportInsights({ workspaceId, month, currency }: { workspaceId: string | undefined; month: string; currency: string }): React.ReactElement {
  const previousMonth = shiftMonth(month, -1);
  const { data: current, isLoading: currentLoading } = useCategoryBreakdown(workspaceId, { month });
  const { data: previous, isLoading: previousLoading } = useCategoryBreakdown(workspaceId, { month: previousMonth });
  const { data: operations } = useTransactions(workspaceId, { month, limit: PAYEE_SAMPLE });
  const { data: accounts } = useAccounts(workspaceId, true);
  const comparison = useMemo(() => compareBreakdowns(current ?? [], previous ?? [], currency), [current, previous, currency]);
  const accountIds = useMemo(() => new Set((accounts ?? []).filter((account) => account.currency === currency).map((account) => account.id)), [accounts, currency]);
  const payees = useMemo(() => (accounts ? topPayees(operations ?? [], undefined, accountIds) : []), [operations, accounts, accountIds]);
  const maxPayee = Math.max(1, ...payees.map((payee) => payee.amount));

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="mb-3 text-xs font-medium text-muted-foreground">Что изменилось против прошлого месяца</p>
        {currentLoading || previousLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : comparison.currentTotal === 0 && comparison.previousTotal === 0 ? (
          <p className="text-xs text-muted-foreground">В этом и в прошлом месяце расходов не было.</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              Расходы: {formatMoney(comparison.currentTotal, currency)} против {formatMoney(comparison.previousTotal, currency)}
              {comparison.previousTotal > 0 ? ` (${signed(Math.round(((comparison.currentTotal - comparison.previousTotal) / comparison.previousTotal) * 100))}%)` : " (прошлый месяц — без расходов)"}
            </p>
            {comparison.categories.length === 0 ? (
              <p className="text-xs text-muted-foreground">По категориям всё как в прошлом месяце.</p>
            ) : (
              <ul className="space-y-1">
                {comparison.categories.map((row) => (
                  <li key={row.categoryId ?? row.categoryName} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-muted-foreground">{row.categoryName}</span>
                    <span className={`shrink-0 font-mono tabular-nums ${row.delta > 0 ? "text-destructive" : "text-success"}`}>
                      {row.delta > 0 ? "+" : "−"}
                      {formatMoney(Math.abs(row.delta), currency)}
                      <span className="ml-1.5 text-subtle-foreground">{row.ratio === null ? "новая" : row.previous > 0 && row.current === 0 ? "ушла" : `${signed(Math.round(row.ratio * 100))}%`}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {payees.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-3 text-xs font-medium text-muted-foreground">Куда уходит больше всего</p>
          <ul className="space-y-2">
            {payees.map((payee) => (
              <li key={payee.key}>
                <div className="mb-1 flex items-center justify-between gap-2 text-2xs">
                  <span className="truncate text-muted-foreground">
                    {payee.label}
                    {payee.count > 1 ? <span className="ml-1.5 text-subtle-foreground">× {payee.count}</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-subtle-foreground">{formatMoney(payee.amount, currency)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-accent/60" style={{ width: `${(payee.amount / maxPayee) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-2xs text-subtle-foreground">Операции группируются по заметке; у операций без заметки — одна группа.</p>
        </div>
      ) : null}

      <ExportButton workspaceId={workspaceId} month={month} />
    </>
  );
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
}

function ExportButton({ workspaceId, month }: { workspaceId: string | undefined; month: string }): React.ReactElement {
  const { api } = useCore();
  const { data: accounts } = useAccounts(workspaceId, true);
  const { data: categories } = useFinanceCategories(workspaceId, true);
  // «Проекты» — соседний модуль: пока он выключен, его API не зовём (названия проектов в файле тогда пустые).
  const { isEnabled } = useEnabledModules();
  const { data: projects } = useProjects(isEnabled("projects") ? workspaceId : undefined, true);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function download(): Promise<void> {
    if (!workspaceId) return;
    setBusy(true);
    try {
      const rows = await api.listTransactions(workspaceId, { month, limit: EXPORT_LIMIT });
      const accountName = new Map((accounts ?? []).map((account) => [account.id, account.name]));
      const categoryName = new Map((categories ?? []).map((category) => [category.id, category.name]));
      const projectName = new Map((projects ?? []).map((project) => [project.id, project.name]));
      const csv = transactionsToCsv(rows, {
        account: (id) => accountName.get(id) ?? "—",
        category: (id) => categoryName.get(id) ?? "—",
        project: (id) => projectName.get(id) ?? ""
      });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `orion-operations-${month}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast({
        title: `Выгружено операций: ${rows.length}`,
        description: rows.length >= EXPORT_LIMIT ? `Файл ограничен ${EXPORT_LIMIT} операциями месяца.` : undefined,
        tone: "success"
      });
    } catch (error) {
      toast({ title: "Не удалось выгрузить", description: describeAuthError(error), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-end">
      <Button size="sm" variant="outline" disabled={busy || !workspaceId} onClick={() => void download()}>
        <Download className="h-4 w-4" /> Выгрузить месяц в CSV
      </Button>
    </div>
  );
}

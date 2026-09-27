"use client";

import {
  useAccounts,
  useCreateRecurringTransaction,
  useDeleteRecurringTransaction,
  useFinanceCategories,
  useRecurringTransactions,
  useUpdateRecurringTransaction
} from "@orion/core-react";
import type { RecurringTransaction } from "@orion/shared-types";
import { Button, ConfirmDialog, EmptyState, IconButton, Modal, Sheet, Skeleton, useToast } from "@orion/ui";
import { ArrowDownLeft, ArrowUpRight, Pause, Play, Plus, Repeat } from "lucide-react";
import { useMemo, useState } from "react";
import { describeAuthError } from "../../lib/error-message";
import { formatMoney, shortDateTime } from "../../lib/format";
import { withArchivedFallback } from "../../lib/finance-options";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { RecurringForm, type RecurringFormValues } from "./recurring-form";

const INTERVAL_LABEL = { weekly: "каждую неделю", monthly: "каждый месяц" } as const;

export function RecurringView(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  // includeArchived: true so an already-archived account/category referenced
  // by an existing rule doesn't vanish from the edit form — see withArchivedFallback.
  const { data: accounts } = useAccounts(workspace?.id, true);
  const { data: categories } = useFinanceCategories(workspace?.id, true);
  const { data: rules, isLoading } = useRecurringTransactions(workspace?.id);
  const createRule = useCreateRecurringTransaction(workspace?.id);
  const updateRule = useUpdateRecurringTransaction(workspace?.id);
  const deleteRule = useDeleteRecurringTransaction(workspace?.id);
  const { toast } = useToast();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RecurringTransaction | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RecurringTransaction | null>(null);

  const activeAccounts = useMemo(() => (accounts ?? []).filter((a) => !a.archivedAt), [accounts]);
  const accountName = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a.name])), [accounts]);
  const hasAccounts = activeAccounts.length > 0;

  async function create(values: RecurringFormValues): Promise<void> {
    try {
      await createRule.mutateAsync(values);
      setCreating(false);
      toast({ title: "Правило создано", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось создать правило", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function save(recurringId: string, values: RecurringFormValues): Promise<void> {
    try {
      await updateRule.mutateAsync({ recurringId, input: values });
      setEditing(null);
      toast({ title: "Сохранено", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить правило", description: describeAuthError(error), tone: "danger" });
    }
  }

  function togglePause(rule: RecurringTransaction): void {
    updateRule.mutate(
      { recurringId: rule.id, input: { pausedAt: rule.pausedAt ? null : new Date().toISOString() } },
      { onSuccess: () => toast({ title: rule.pausedAt ? "Возобновлено" : "Приостановлено", tone: "default" }) }
    );
  }

  function confirmDelete(): void {
    const rule = pendingDelete;
    if (!rule) return;
    setPendingDelete(null);
    deleteRule.mutate(rule.id, { onSuccess: () => toast({ title: "Правило удалено", tone: "default" }) });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)} disabled={!hasAccounts}>
          <Plus className="h-4 w-4" /> Правило
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : rules && rules.length > 0 ? (
        <ul className="space-y-1.5">
          {rules.map((rule) => {
            const isIncome = rule.type === "income";
            const paused = rule.pausedAt !== null;
            return (
              <li
                key={rule.id}
                className={`flex items-center gap-3 rounded-xl border border-border px-3 py-row ${paused ? "opacity-50" : ""}`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    isIncome ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
                  }`}
                >
                  {isIncome ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                </span>
                <button type="button" onClick={() => setEditing(rule)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm text-foreground">{rule.note || accountName.get(rule.accountId) || "Правило"}</p>
                  <p className="mt-0.5 text-2xs text-subtle-foreground">
                    {INTERVAL_LABEL[rule.interval]} · {accountName.get(rule.accountId) ?? "—"} · следующее{" "}
                    {shortDateTime(rule.nextRunAt)}
                  </p>
                </button>
                <span className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${isIncome ? "text-success" : "text-destructive"}`}>
                  {isIncome ? "+" : "−"}
                  {formatMoney(rule.amount)}
                </span>
                <IconButton label={paused ? "Возобновить" : "Приостановить"} size="sm" onClick={() => togglePause(rule)}>
                  {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                </IconButton>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={Repeat}
          title="Повторяющихся операций нет"
          description={
            hasAccounts
              ? "Регулярные платежи или доходы — например, подписка или зарплата."
              : "Сначала заведите счёт — во вкладке «Счета»."
          }
          action={
            hasAccounts ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Правило
              </Button>
            ) : undefined
          }
        />
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Новое повторяющееся правило" size="sm">
        <RecurringForm
          accounts={activeAccounts}
          categories={(categories ?? []).filter((c) => !c.archivedAt)}
          busy={createRule.isPending}
          submitLabel="Создать"
          onCancel={() => setCreating(false)}
          onSubmit={create}
        />
      </Modal>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title="Повторяющееся правило">
        {editing ? (
          <div className="p-5">
            <RecurringForm
              key={editing.id}
              initial={editing}
              accounts={withArchivedFallback(accounts ?? [], editing.accountId)}
              categories={withArchivedFallback(categories ?? [], editing.categoryId)}
              busy={updateRule.isPending}
              submitLabel="Сохранить"
              onCancel={() => setEditing(null)}
              onSubmit={(values) => save(editing.id, values)}
            />
            <div className="mt-4 border-t border-border pt-4">
              <Button variant="danger" size="sm" onClick={() => setPendingDelete(editing)}>
                Удалить правило
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить правило?"
        description="Уже созданные по нему операции останутся. Действие необратимо."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

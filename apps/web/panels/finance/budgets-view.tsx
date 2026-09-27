"use client";

import { useBudgets, useCreateBudget, useDeleteBudget, useFinanceCategories, useUpdateBudget } from "@orion/core-react";
import type { Budget } from "@orion/shared-types";
import { Button, ConfirmDialog, EmptyState, IconButton, Modal, useToast } from "@orion/ui";
import { ChevronLeft, ChevronRight, Pencil, PiggyBank, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { describeAuthError } from "../../lib/error-message";
import { formatMoney } from "../../lib/format";
import { withArchivedFallback } from "../../lib/finance-options";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { BudgetForm, type BudgetFormValues } from "./budget-form";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthIndex - 1, 1)).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}

export function BudgetsView(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const [month, setMonth] = useState(currentMonth());
  const { data: budgets, isLoading } = useBudgets(workspace?.id, month);
  // includeArchived: true so an already-archived category referenced by an
  // existing budget doesn't vanish from the edit form — see withArchivedFallback.
  const { data: categories } = useFinanceCategories(workspace?.id, true);
  const createBudget = useCreateBudget(workspace?.id);
  const updateBudget = useUpdateBudget(workspace?.id);
  const deleteBudget = useDeleteBudget(workspace?.id);
  const { toast } = useToast();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Budget | null>(null);

  const expenseCategoriesAll = (categories ?? []).filter((c) => c.kind === "expense");
  const expenseCategories = expenseCategoriesAll.filter((c) => !c.archivedAt);
  const budgetedCategoryIds = new Set((budgets ?? []).map((b) => b.categoryId));
  const availableCategories = expenseCategories.filter((c) => !budgetedCategoryIds.has(c.id));

  async function create(values: BudgetFormValues): Promise<void> {
    try {
      await createBudget.mutateAsync(values);
      setCreating(false);
      toast({ title: "Бюджет создан", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось создать бюджет", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function save(budgetId: string, values: BudgetFormValues): Promise<void> {
    try {
      await updateBudget.mutateAsync({ budgetId, input: { limitAmount: values.limitAmount } });
      setEditing(null);
      toast({ title: "Сохранено", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить бюджет", description: describeAuthError(error), tone: "danger" });
    }
  }

  function confirmDelete(): void {
    const budget = pendingDelete;
    if (!budget) return;
    setPendingDelete(null);
    deleteBudget.mutate(budget.id, { onSuccess: () => toast({ title: "Бюджет удалён", tone: "default" }) });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton label="Предыдущий месяц" size="sm" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <span className="min-w-[9rem] text-center text-sm font-medium capitalize text-foreground">{monthLabel(month)}</span>
          <IconButton label="Следующий месяц" size="sm" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            <ChevronRight className="h-4 w-4" />
          </IconButton>
        </div>
        <Button size="sm" onClick={() => setCreating(true)} disabled={availableCategories.length === 0}>
          <Plus className="h-4 w-4" /> Бюджет
        </Button>
      </div>

      {isLoading ? null : budgets && budgets.length > 0 ? (
        <ul className="space-y-3">
          {budgets.map((budget) => {
            const category = categories?.find((c) => c.id === budget.categoryId);
            const ratio = budget.limitAmount > 0 ? budget.spent / budget.limitAmount : 0;
            const over = ratio > 1;
            return (
              <li key={budget.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{category?.name ?? "Категория"}</span>
                  <div className="flex items-center gap-1">
                    <span className={`font-mono text-xs tabular-nums ${over ? "text-destructive" : "text-muted-foreground"}`}>
                      {formatMoney(budget.spent)} из {formatMoney(budget.limitAmount)}
                    </span>
                    <IconButton label="Изменить лимит" size="sm" onClick={() => setEditing(budget)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton label="Удалить бюджет" size="sm" tone="danger" onClick={() => setPendingDelete(budget)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ease-out ${over ? "bg-destructive" : "bg-accent"}`}
                    style={{ width: `${Math.min(100, ratio * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={PiggyBank}
          title="Бюджетов на этот месяц нет"
          description={
            expenseCategories.length === 0
              ? "Сначала заведите расходную категорию (кнопка «Категории» в шапке)."
              : "Задайте лимит на месяц по одной из категорий расходов."
          }
          action={
            expenseCategories.length > 0 ? (
              <Button size="sm" onClick={() => setCreating(true)} disabled={availableCategories.length === 0}>
                <Plus className="h-4 w-4" /> Бюджет
              </Button>
            ) : undefined
          }
        />
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Новый бюджет" size="sm">
        <BudgetForm
          expenseCategories={availableCategories}
          defaultMonth={month}
          busy={createBudget.isPending}
          submitLabel="Создать"
          onCancel={() => setCreating(false)}
          onSubmit={create}
        />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Бюджет" size="sm">
        {editing ? (
          <BudgetForm
            key={editing.id}
            initial={editing}
            expenseCategories={withArchivedFallback(expenseCategoriesAll, editing.categoryId)}
            defaultMonth={month}
            busy={updateBudget.isPending}
            submitLabel="Сохранить"
            onCancel={() => setEditing(null)}
            onSubmit={(values) => save(editing.id, values)}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить бюджет?"
        description="Действие необратимо — сами операции не пострадают."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

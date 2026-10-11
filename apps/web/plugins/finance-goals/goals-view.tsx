"use client";

import {
  useAccounts,
  useCreateGoal,
  useDeleteGoal,
  useGoals,
  useUpdateGoal
} from "@orion/core-react";
import type { SavingsGoal } from "@orion/shared-types";
import { Button, ConfirmDialog, DropdownMenu, EmptyState, IconButton, Modal, Skeleton, useToast } from "@orion/ui";
import { ArchiveRestore, Archive, MoreHorizontal, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { useState } from "react";
import { describeAuthError } from "../../lib/extensions/host-api";
import { formatMoney } from "../../lib/extensions/host-api";
import { withArchivedFallback } from "../../lib/extensions/host-api";
import { useActiveWorkspace } from "../../lib/extensions/host-api";
import { GoalForm, type GoalFormValues } from "./goal-form";

function daysLeft(targetDate: string): number {
  return Math.ceil((new Date(targetDate).getTime() - Date.now()) / (24 * 3600 * 1000));
}

/**
 * A goal is tied to one savings account (v0.13, see docs/HISTORY.md) —
 * `currentAmount` is just that account's live balance, computed server-side;
 * there's no separate contribution ledger to maintain here.
 */
export function GoalsView(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const { data: goals, isLoading } = useGoals(workspace?.id);
  const { data: accounts } = useAccounts(workspace?.id, true);
  const createGoal = useCreateGoal(workspace?.id);
  const updateGoal = useUpdateGoal(workspace?.id);
  const deleteGoal = useDeleteGoal(workspace?.id);
  const { toast } = useToast();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SavingsGoal | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SavingsGoal | null>(null);

  const activeAccounts = (accounts ?? []).filter((a) => !a.archivedAt);
  const hasAccounts = activeAccounts.length > 0;

  async function create(values: GoalFormValues): Promise<void> {
    try {
      await createGoal.mutateAsync(values);
      setCreating(false);
      toast({ title: "Цель создана", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось создать цель", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function save(goalId: string, values: GoalFormValues): Promise<void> {
    try {
      await updateGoal.mutateAsync({ goalId, input: values });
      setEditing(null);
      toast({ title: "Сохранено", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить цель", description: describeAuthError(error), tone: "danger" });
    }
  }

  function toggleArchived(goal: SavingsGoal): void {
    updateGoal.mutate(
      { goalId: goal.id, input: { archivedAt: goal.archivedAt ? null : new Date().toISOString() } },
      { onSuccess: () => toast({ title: goal.archivedAt ? "Цель восстановлена" : "Цель отправлена в архив", tone: "default" }) }
    );
  }

  function confirmDelete(): void {
    const goal = pendingDelete;
    if (!goal) return;
    setPendingDelete(null);
    deleteGoal.mutate(goal.id, { onSuccess: () => toast({ title: "Цель удалена", tone: "default" }) });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)} disabled={!hasAccounts}>
          <Plus className="h-4 w-4" /> Новая цель
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : goals && goals.length > 0 ? (
        <ul className="space-y-3">
          {goals.map((goal) => {
            const ratio = goal.targetAmount > 0 ? goal.currentAmount / goal.targetAmount : 0;
            const reached = ratio >= 1;
            const left = goal.targetDate ? daysLeft(goal.targetDate) : null;
            return (
              <li key={goal.id} className={`rounded-xl border border-border p-3 ${goal.archivedAt ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{goal.name}</span>
                  <div className="flex items-center gap-1">
                    <span className={`text-xs ${reached ? "text-success" : "text-muted-foreground"}`}>
                      {formatMoney(goal.currentAmount)} из {formatMoney(goal.targetAmount)}
                    </span>
                    <DropdownMenu
                      trigger={({ toggle }) => (
                        <IconButton label="Действия" size="sm" onClick={toggle}>
                          <MoreHorizontal className="h-4 w-4" />
                        </IconButton>
                      )}
                      items={[
                        { label: "Изменить", icon: Pencil, onSelect: () => setEditing(goal) },
                        goal.archivedAt
                          ? { label: "Восстановить", icon: ArchiveRestore, onSelect: () => toggleArchived(goal) }
                          : { label: "Архивировать", icon: Archive, onSelect: () => toggleArchived(goal) },
                        { label: "Удалить", icon: Trash2, tone: "danger", onSelect: () => setPendingDelete(goal) }
                      ]}
                    />
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ease-out ${reached ? "bg-success" : "bg-accent"}`}
                    style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
                  />
                </div>
                {left !== null ? (
                  <p className="mt-1.5 text-2xs text-subtle-foreground">
                    {left > 0 ? `Осталось ${left} дн.` : left === 0 ? "Срок сегодня" : `Просрочено на ${-left} дн.`}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={Target}
          title="Целей накопления пока нет"
          description={
            hasAccounts ? "Привяжите цель к накопительному счёту, чтобы видеть прогресс." : "Сначала заведите счёт — во вкладке «Счета»."
          }
          action={
            hasAccounts ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Новая цель
              </Button>
            ) : undefined
          }
        />
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Новая цель" size="sm">
        <GoalForm accounts={activeAccounts} busy={createGoal.isPending} submitLabel="Создать" onCancel={() => setCreating(false)} onSubmit={create} />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Цель" size="sm">
        {editing ? (
          <GoalForm
            key={editing.id}
            initial={editing}
            accounts={withArchivedFallback(accounts ?? [], editing.accountId)}
            busy={updateGoal.isPending}
            submitLabel="Сохранить"
            onCancel={() => setEditing(null)}
            onSubmit={(values) => save(editing.id, values)}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить цель?"
        description="Сам счёт и операции по нему не пострадают. Действие необратимо."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

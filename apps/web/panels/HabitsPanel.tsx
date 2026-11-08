"use client";

import { ApiError } from "@orion/core";
import {
  useArchiveHabit,
  useCreateHabit,
  useHabitEntries,
  useHabits,
  useToggleHabit,
  useUpdateHabit
} from "@orion/core-react";
import { habitLocalDayKey, type Habit } from "@orion/shared-types";
import {
  Button,
  EmptyState,
  Modal,
  PanelBody,
  PanelHeader,
  PanelSection,
  PanelShell,
  Sheet,
  Skeleton,
  StatCard,
  CircularProgress,
  CountUp,
  cx,
  useToast,
  useUiSound
} from "@orion/ui";
import { Archive, Plus, Target, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useLocalNow } from "../lib/use-day-boundary";
import { describeError } from "../lib/error-message";
import { ArchiveRow, TodayRow } from "./habits/habit-row";
import { HabitForm, type HabitFormValues } from "./habits/habit-form";
import { buildWeek, entryDaysByHabit, isDueToday, pluralDays, pluralHabits, streakLabel } from "../lib/habit-days";
import { ExtensionSlot, useSlotContributions } from "../lib/extensions/slot";

/**
 * Привычки (v0.19): the daily checklist, the summary and the archive. The week grid and
 * the 12-week activity map are the `habits-insights` plugin: they arrive through the
 * `habits.insights` slot, and with the plugin off this panel is simply the checklist.
 *
 * Two caches feed it — `["habits", ws, includeArchived]` (the one list the panel
 * splits into today / archive) and `["habit-entries", ws, {from, to}]` (this week's
 * ticks, which is what "done today" reads). Every mutation invalidates both; `toggle`
 * additionally patches them optimistically.
 *
 * The panel always works in the **user's** days: the visible week is the local
 * week, and every tick is sent with `habitLocalDayKey(...)` so the server never
 * substitutes its own UTC day.
 */
export function HabitsPanel(): React.ReactElement {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;

  const [showArchive, setShowArchive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);

  // "Today" and "this week" come from the S10 day-boundary hook: it only
  // changes at a real local midnight or a visibility/focus wake, never on an
  // arbitrary re-render, so the columns don't shift under the cursor mid-
  // interaction — the concern a plain `useState(() => new Date())` here used
  // to guard against — while still catching up after the panel has been open
  // since before midnight, or the laptop slept through the night, instead of
  // staying frozen on the day it was opened on.
  const now = useLocalNow();
  const week = useMemo(() => buildWeek(now), [now]);
  const todayKey = habitLocalDayKey(now);

  // The user's own day goes to the API as `?today=`, so its `dueToday`,
  // `doneToday` and `streak` are computed against the day the user is living in
  // rather than the server's UTC day. One source of truth, no client-side
  // reconciliation.
  const habitsQuery = useHabits(workspaceId, showArchive, todayKey);
  const entriesQuery = useHabitEntries(workspaceId, { from: week[0].key, to: week[6].key });

  const createHabit = useCreateHabit(workspaceId);
  const updateHabit = useUpdateHabit(workspaceId);
  const archiveHabit = useArchiveHabit(workspaceId);
  const toggleHabit = useToggleHabit(workspaceId);
  const { toast } = useToast();
  const { play } = useUiSound();

  const habits = habitsQuery.data ?? [];
  const activeHabits = habits.filter((habit) => !habit.archivedAt);
  const archivedHabits = habits.filter((habit) => habit.archivedAt);
  // `dueToday` is the server's answer for the day *we* sent (see useHabits), so
  // the panel doesn't second-guess the schedule here.
  const dueHabits = activeHabits.filter(isDueToday);

  const entryDays = entryDaysByHabit(entriesQuery.data);
  const entriesLoaded = entriesQuery.data !== undefined;

  /**
   * The checkbox reads the tick list (the source of truth for the visible week)
   * whenever it is cached, and the server's `doneToday` while the week is still
   * loading. Both are computed for the same day now, so the fallback can't
   * disagree with the grid.
   */
  function isDoneToday(habit: Habit): boolean {
    if (!entriesLoaded) return habit.doneToday;
    return entryDays.get(habit.id)?.has(todayKey) ?? false;
  }

  const doneToday = dueHabits.filter(isDoneToday).length;
  const bestStreak = activeHabits.reduce((best, habit) => Math.max(best, habit.streak), 0);
  const toggling = toggleHabit.isPending;
  // The layout adapts to whether anything fills the insights slot: two columns when it does, one when not.
  const hasInsights = useSlotContributions("habits.insights").length > 0;

  function toggle(habitId: string, day: string, wasDone: boolean): void {
    if (!wasDone) play("action.check");
    toggleHabit.mutate(
      { habitId, day },
      {
        onError: () =>
          toast({ title: "Не удалось отметить", description: "Проверьте соединение и попробуйте ещё раз.", tone: "danger" })
      }
    );
  }

  async function create(values: HabitFormValues): Promise<void> {
    try {
      await createHabit.mutateAsync(values);
      setCreating(false);
      toast({ title: "Привычка создана", tone: "success" });
    } catch (error) {
      toast({
        title: "Не удалось создать привычку",
        description: error instanceof ApiError ? error.message : undefined,
        tone: "danger"
      });
    }
  }

  async function save(habitId: string, values: HabitFormValues): Promise<void> {
    try {
      await updateHabit.mutateAsync({ habitId, input: values });
      setEditing(null);
      toast({ title: "Сохранено", tone: "success" });
    } catch (error) {
      toast({
        title: "Не удалось сохранить привычку",
        description: error instanceof ApiError ? error.message : undefined,
        tone: "danger"
      });
    }
  }

  function doArchive(habit: Habit): void {
    archiveHabit.mutate(habit.id, {
      onSuccess: () => {
        setEditing((current) => (current?.id === habit.id ? null : current));
        toast({
          title: "В архиве",
          action: {
            label: "Отменить",
            onClick: () => {
              void updateHabit.mutateAsync({ habitId: habit.id, input: { archivedAt: null } });
            }
          }
        });
      },
      onError: () => toast({ title: "Не удалось убрать в архив", tone: "danger" })
    });
  }

  async function restore(habit: Habit): Promise<void> {
    try {
      // Un-archiving is an update, not a route of its own (see ApiClient.archiveHabit).
      await updateHabit.mutateAsync({ habitId: habit.id, input: { archivedAt: null } });
      toast({ title: "Привычка возвращена", tone: "success" });
    } catch (error) {
      toast({
        title: "Не удалось вернуть привычку",
        description: error instanceof ApiError ? error.message : undefined,
        tone: "danger"
      });
    }
  }

  return (
    <PanelShell>
      <PanelHeader
        icon={Target}
        title="Привычки"
        subtitle="Отмечайте сделанное — серия считается сама"
        actions={
          <Button size="sm" onClick={() => setCreating(true)} disabled={workspaceId === undefined}>
            <Plus className="h-4 w-4" /> Новая привычка
          </Button>
        }
      >
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchive}
            disabled={workspaceId === undefined}
            onChange={(event) => setShowArchive(event.target.checked)}
          />
          Показать архив
        </label>
      </PanelHeader>

      <PanelBody measure="wide" className="[container-type:inline-size]">
        {workspaceId === undefined ? (
          workspaceLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Target}
              title="Нет рабочего пространства"
              description="Привычки живут внутри пространства — создайте его или войдите заново."
            />
          )
        ) : habitsQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : habitsQuery.isError ? (
          <EmptyState
            icon={TriangleAlert}
            tone="danger"
            title="Не удалось загрузить привычки"
            description={describeError(habitsQuery.error)}
            action={
              <Button size="sm" variant="outline" onClick={() => void habitsQuery.refetch()}>
                Повторить
              </Button>
            }
          />
        ) : activeHabits.length === 0 && archivedHabits.length === 0 ? (
          <EmptyState
            icon={Target}
            title="Привычек пока нет"
            description="Заведите первую — например, «зарядка» на будни. Пустое расписание значит «каждый день»."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Новая привычка
              </Button>
            }
          />
        ) : (
          // Today's tick is the daily action, so it leads and stays in the first column; the
          // week grid and heatmap are history and sit beside it on a wide panel (by the
          // panel's own width, not the window's) instead of leaving half the screen empty.
          <div
            className={cx(
              "grid grid-cols-1 gap-6",
              hasInsights && "[@container(min-width:880px)]:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]"
            )}
          >
            <div className="min-w-0 space-y-6">
            <PanelSection title="Сегодня">
              {dueHabits.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  На сегодня по расписанию ничего нет — отдыхайте или отметьте клетку в неделе ниже.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {dueHabits.map((habit) => (
                    <li key={habit.id}>
                      <TodayRow
                        habit={habit}
                        checked={isDoneToday(habit)}
                        busy={toggling}
                        onToggle={() => toggle(habit.id, todayKey, isDoneToday(habit))}
                        onEdit={() => setEditing(habit)}
                        onArchive={() => doArchive(habit)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </PanelSection>

            <PanelSection title="Итоги">
              <div className="mb-2">
                <CircularProgress
                  label="Сегодня по расписанию"
                  value={dueHabits.length === 0 ? 0 : (doneToday / dueHabits.length) * 100}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <StatCard label="Сегодня" value={`${doneToday} из ${dueHabits.length}`} hint="по расписанию" />
                <StatCard
                  label="Лучшая серия"
                  value={bestStreak > 0 ? `${bestStreak} ${pluralDays(bestStreak)}` : "—"}
                  hint={bestStreak > 0 ? "подряд" : "отметьте день"}
                />
                <StatCard
                  label="Активных"
                  value={String(activeHabits.length)}
                  hint={pluralHabits(activeHabits.length)}
                />
              </div>
            </PanelSection>
            </div>

            <ExtensionSlot
              name="habits.insights"
              wrapperClassName="min-w-0 space-y-6"
              props={{ workspaceId, habits: activeHabits, onEditHabit: setEditing, onArchiveHabit: doArchive }}
            />

            {showArchive ? (
              <div className="min-w-0 [@container(min-width:880px)]:col-span-2">
              <PanelSection title="Архив">
                {archivedHabits.length === 0 ? (
                  <p className="text-xs text-muted-foreground">В архиве пусто.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {archivedHabits.map((habit) => (
                      <li key={habit.id}>
                        <ArchiveRow habit={habit} busy={updateHabit.isPending} onRestore={() => void restore(habit)} />
                      </li>
                    ))}
                  </ul>
                )}
              </PanelSection>
              </div>
            ) : null}
          </div>
        )}
      </PanelBody>

      <Modal open={creating} onClose={() => setCreating(false)} title="Новая привычка" size="sm">
        <HabitForm
          busy={createHabit.isPending}
          submitLabel="Создать"
          onCancel={() => setCreating(false)}
          onSubmit={create}
        />
      </Modal>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.name ?? "Привычка"}
        width="32rem"
        footer={
          editing && !editing.archivedAt ? (
            <Button size="sm" variant="subtle" onClick={() => doArchive(editing)}>
              <Archive className="h-4 w-4" /> В архив
            </Button>
          ) : undefined
        }
      >
        {editing ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                label="Серия"
                value={editing.streak > 0 ? String(editing.streak) : "—"}
                hint={editing.streak > 0 ? streakLabel(editing.streak) : "отметьте день"}
              />
              <StatCard
                label="Сегодня"
                value={isDoneToday(editing) ? "есть" : isDueToday(editing) ? "ждёт" : "не в расписании"}
                hint={editing.weekdays.length === 0 ? "каждый день" : undefined}
              />
            </div>
            <ExtensionSlot
              name="habits.detail"
              props={{ workspaceId, habit: habits.find((habit) => habit.id === editing.id) ?? editing, onArchiveHabit: doArchive }}
            />
            <HabitForm
              key={editing.id}
              initial={habits.find((habit) => habit.id === editing.id) ?? editing}
              busy={updateHabit.isPending}
              submitLabel="Сохранить"
              onCancel={() => setEditing(null)}
              onSubmit={(values) => save(editing.id, values)}
            />
          </div>
        ) : null}
      </Sheet>
    </PanelShell>
  );
}

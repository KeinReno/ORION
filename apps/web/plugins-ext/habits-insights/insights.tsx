"use client";

import { useHabitEntries, useToggleHabit } from "@orion/core-react";
import { PanelSection, Skeleton, useToast } from "@orion/ui";
import { useMemo, useState } from "react";
import type { HabitsInsightsSlotProps } from "../../lib/extensions/contracts";
import { buildHeatmapWeeks, buildWeek, entryDaysByHabit, streakLabel } from "../../lib/extensions/host-api";
import { useLocalNow } from "../../lib/extensions/host-api";
import { HabitsHeatmap } from "./heatmap";
import { WeekGrid } from "./week-grid";

const HEATMAP_WEEKS = 12;

/**
 * Plugin `habits-insights`: the week grid and the 12-week activity map. It fills the
 * `habits.insights` slot of the Habits module. Everything it needs comes through the slot's
 * typed props and the public client hooks; it owns its own queries (the week's ticks and the
 * wider heatmap range), so with the plugin off nothing here is fetched at all.
 *
 * Days are the user's local days, like the rest of the module: every tick is sent with the
 * clicked cell's own day key, never the server's idea of today. The grid starts on the
 * current week and pages backwards one week at a time, so a tick forgotten earlier can be
 * recorded on the day it actually happened — the API accepts any past day.
 */
export function HabitsInsights({ workspaceId, habits, onEditHabit, onArchiveHabit }: HabitsInsightsSlotProps): React.ReactElement {
  const { toast } = useToast();
  const now = useLocalNow();
  // 0 = the week containing today; the grid pages backwards from there. Shifting
  // by whole weeks keeps buildWeek's Monday-first columns aligned with today.
  const [weekOffset, setWeekOffset] = useState(0);
  const weekAnchor = useMemo(
    () => new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekOffset * 7),
    [now, weekOffset]
  );
  const week = useMemo(() => buildWeek(weekAnchor), [weekAnchor]);
  const heatmapWeeks = useMemo(() => buildHeatmapWeeks(now, HEATMAP_WEEKS), [now]);
  const toggleHabit = useToggleHabit(workspaceId);

  const entriesQuery = useHabitEntries(workspaceId, { from: week[0].key, to: week[6].key });
  // Separate cache key (wider range) for the heatmap only — the weekly grid stays a cheap
  // one-week fetch even while 12 weeks load underneath it.
  const heatmapEntriesQuery = useHabitEntries(workspaceId, {
    from: heatmapWeeks[0][0].key,
    to: heatmapWeeks[HEATMAP_WEEKS - 1][6].key
  });
  const entryDays = entryDaysByHabit(entriesQuery.data);
  const heatmapDays = useMemo(() => entryDaysByHabit(heatmapEntriesQuery.data), [heatmapEntriesQuery.data]);
  const bestStreak = habits.reduce((best, habit) => Math.max(best, habit.streak), 0);

  function toggle(habitId: string, day: string): void {
    toggleHabit.mutate(
      { habitId, day },
      {
        onError: () =>
          toast({ title: "Не удалось отметить", description: "Проверьте соединение и попробуйте ещё раз.", tone: "danger" })
      }
    );
  }

  return (
    <>
      <PanelSection
        title="Неделя"
        actions={
          habits.length > 0 ? (
            <span className="text-2xs text-subtle-foreground">
              {bestStreak > 0 ? `Лучшая серия: ${streakLabel(bestStreak)}` : "клик по клетке — отметка"}
            </span>
          ) : undefined
        }
      >
        {habits.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Все привычки в архиве — включите «Показать архив», чтобы вернуть нужную.
          </p>
        ) : entriesQuery.isLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: habits.length }).map((_, index) => (
              <Skeleton key={index} className="h-7 w-full" />
            ))}
          </div>
        ) : (
          <WeekGrid
            habits={habits}
            week={week}
            days={entryDays}
            busy={toggleHabit.isPending}
            onToggle={toggle}
            onEdit={onEditHabit}
            onArchive={onArchiveHabit}
            weekOffset={weekOffset}
            onWeekOffsetChange={(delta) => setWeekOffset((current) => Math.max(0, current + delta))}
          />
        )}
      </PanelSection>

      {habits.length > 0 ? (
        <PanelSection title="Активность" actions={<span className="text-2xs text-subtle-foreground">{HEATMAP_WEEKS} недель</span>}>
          {heatmapEntriesQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <HabitsHeatmap weeks={heatmapWeeks} habits={habits} days={heatmapDays} />
          )}
        </PanelSection>
      ) : null}
    </>
  );
}

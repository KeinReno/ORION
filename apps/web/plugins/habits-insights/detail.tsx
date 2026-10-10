"use client";

import { useHabitEntries, useToggleHabit } from "@orion/core-react";
import { Skeleton, useToast } from "@orion/ui";
import { useMemo } from "react";
import type { HabitDetailSlotProps } from "../../lib/extensions/contracts";
import { buildHeatmapWeeks, buildWeek, entryDaysByHabit } from "../../lib/habit-days";
import { useLocalNow } from "../../lib/use-day-boundary";
import { HabitsHeatmap } from "./heatmap";
import { WeekGrid } from "./week-grid";

const HEATMAP_WEEKS = 12;

/** Plugin `habits-insights`, second contribution: this habit's own week and activity map in the edit sheet. */
export function HabitDetailInsights({ workspaceId, habit, onArchiveHabit }: HabitDetailSlotProps): React.ReactElement {
  const { toast } = useToast();
  const now = useLocalNow();
  const week = useMemo(() => buildWeek(now), [now]);
  const heatmapWeeks = useMemo(() => buildHeatmapWeeks(now, HEATMAP_WEEKS), [now]);
  const toggleHabit = useToggleHabit(workspaceId);
  const entriesQuery = useHabitEntries(workspaceId, { from: week[0].key, to: week[6].key });
  const heatmapEntriesQuery = useHabitEntries(workspaceId, {
    from: heatmapWeeks[0][0].key,
    to: heatmapWeeks[HEATMAP_WEEKS - 1][6].key
  });
  const entryDays = entryDaysByHabit(entriesQuery.data);
  const heatmapDays = useMemo(() => entryDaysByHabit(heatmapEntriesQuery.data), [heatmapEntriesQuery.data]);

  return (
    <>
      {entriesQuery.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <WeekGrid
          habits={[habit]}
          week={week}
          days={entryDays}
          busy={toggleHabit.isPending}
          onToggle={(habitId, day) =>
            toggleHabit.mutate(
              { habitId, day },
              { onError: () => toast({ title: "Не удалось отметить", description: "Проверьте соединение и попробуйте ещё раз.", tone: "danger" }) }
            )
          }
          onEdit={() => undefined}
          onArchive={onArchiveHabit}
        />
      )}
      {heatmapEntriesQuery.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <HabitsHeatmap weeks={heatmapWeeks} habits={[habit]} days={heatmapDays} />
      )}
    </>
  );
}

"use client";

import {
  habitLocalDayKey,
  type CreateHabitInput,
  type Habit,
  type HabitEntry,
  type ToggleHabitInput,
  type ToggleHabitResult,
  type UpdateHabitInput
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCore } from "./provider";

/** Day window for the tick list (`YYYY-MM-DD` days, both bounds inclusive). */
export interface HabitEntryFilters {
  from?: string;
  to?: string;
}

/**
 * Habits of a workspace. `includeArchived` mirrors the API's
 * `?includeArchived=true`: the panel keeps one list and splits it into the
 * daily checklist, the week grid and the archive, so switching the archive on
 * never means a second source of truth for the same habit.
 *
 * `today` is the user's own calendar day (`habitLocalDayKey()`): the API needs
 * it to compute `dueToday`/`streak`/`doneToday` against the day the user is
 * actually living in, not the server's UTC day.
 */
export function useHabits(workspaceId: string | undefined, includeArchived = false, today?: string) {
  const { api } = useCore();
  return useQuery<Habit[]>({
    queryKey: ["habits", workspaceId, includeArchived, today ?? ""],
    queryFn: () => api.listHabits(workspaceId as string, includeArchived, today),
    enabled: Boolean(workspaceId)
  });
}

/**
 * Ticks in a day window — the week grid's only data source (`from`/`to` are the
 * Monday and Sunday of the visible week). `habit.entries` is a flat history, so
 * a client-side window is the natural fit; the server still bounds the answer.
 */
export function useHabitEntries(workspaceId: string | undefined, filters?: HabitEntryFilters) {
  const { api } = useCore();
  return useQuery<HabitEntry[]>({
    queryKey: ["habit-entries", workspaceId, filters],
    queryFn: () => api.listHabitEntries(workspaceId as string, filters),
    enabled: Boolean(workspaceId)
  });
}

/**
 * Both keys travel together: a tick changes `doneToday`/`streak` in the habit
 * list *and* the week grid, and every habit mutation (rename, schedule edit,
 * archive) can move a habit between those two views.
 */
function useInvalidateHabits(workspaceId: string | undefined): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["habits", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["habit-entries", workspaceId] });
  };
}

export function useCreateHabit(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateHabits(workspaceId);
  return useMutation<Habit, Error, CreateHabitInput>({
    mutationFn: (input: CreateHabitInput) => api.createHabit(workspaceId as string, input),
    onSuccess: invalidate
  });
}

export function useUpdateHabit(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateHabits(workspaceId);
  return useMutation<Habit, Error, { habitId: string; input: UpdateHabitInput }>({
    mutationFn: ({ habitId, input }: { habitId: string; input: UpdateHabitInput }) =>
      api.updateHabit(workspaceId as string, habitId, input),
    onSuccess: invalidate
  });
}

/** `DELETE` clears the habit from the daily list; its ticks stay and `useUpdateHabit` with `{ archivedAt: null }` brings it back. */
export function useArchiveHabit(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateHabits(workspaceId);
  return useMutation<Habit, Error, string>({
    mutationFn: (habitId: string) => api.archiveHabit(workspaceId as string, habitId),
    onSuccess: invalidate
  });
}

export interface ToggleHabitVars extends ToggleHabitInput {
  habitId: string;
  /** Required here even though the contract makes it optional: the server's default is its UTC day, never the user's. */
  day: string;
}

interface ToggleHabitSnapshot {
  habits: [QueryKey, Habit[] | undefined][];
  entries: [QueryKey, HabitEntry[] | undefined][];
}

/**
 * The checkbox has to answer instantly, so this mutation patches the caches
 * before the request resolves and rolls them back on error.
 *
 * Only `doneToday` is flipped (never `streak`/`dueToday`, which are server-side
 * derivations over the whole history — they are simply invalidated afterwards),
 * plus the matching day in the tick list so the week cell and the daily checkbox
 * can't disagree while the refetch is in flight. The direction is read from the
 * tick list when it is already cached and from `doneToday` otherwise — the same
 * precedence the panel uses to render the checkbox.
 */
export function useToggleHabit(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateHabits(workspaceId);

  return useMutation<ToggleHabitResult, Error, ToggleHabitVars, ToggleHabitSnapshot>({
    mutationFn: ({ habitId, day }: ToggleHabitVars) => api.toggleHabit(workspaceId as string, habitId, { day }),
    onMutate: async ({ habitId, day }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["habits", workspaceId] }),
        queryClient.cancelQueries({ queryKey: ["habit-entries", workspaceId] })
      ]);

      const snapshot: ToggleHabitSnapshot = {
        habits: queryClient.getQueriesData<Habit[]>({ queryKey: ["habits", workspaceId] }),
        entries: queryClient.getQueriesData<HabitEntry[]>({ queryKey: ["habit-entries", workspaceId] })
      };
      const todayKey = habitLocalDayKey();
      const cachedEntries = snapshot.entries.find(([, list]) => list !== undefined)?.[1];
      const cachedHabits = snapshot.habits.find(([, list]) => list !== undefined)?.[1] ?? [];
      const done = cachedEntries
        ? cachedEntries.some((entry) => entry.habitId === habitId && entry.day === day)
        : day === todayKey && cachedHabits.some((habit) => habit.id === habitId && habit.doneToday);

      queryClient.setQueriesData<Habit[]>({ queryKey: ["habits", workspaceId] }, (list) =>
        list?.map((habit) =>
          habit.id === habitId && day === todayKey ? { ...habit, doneToday: !done } : habit
        )
      );
      queryClient.setQueriesData<HabitEntry[]>({ queryKey: ["habit-entries", workspaceId] }, (list) => {
        if (!list) return list;
        return done
          ? list.filter((entry) => !(entry.habitId === habitId && entry.day === day))
          : // A placeholder id: the refetch in `onSettled` replaces this row with the server's own.
            [
              ...list,
              { id: `pending-${habitId}-${day}`, habitId, day, createdAt: new Date().toISOString() }
            ];
      });

      return snapshot;
    },
    onError: (_error, _vars, snapshot) => {
      for (const [key, list] of snapshot?.habits ?? []) queryClient.setQueryData(key, list);
      for (const [key, list] of snapshot?.entries ?? []) queryClient.setQueryData(key, list);
    },
    onSettled: invalidate
  });
}

"use client";

import type {
  CreateTimeEntryInput,
  StartTimerInput,
  StopTimerInput,
  TimeEntry,
  TimeEntryPage,
  TimeSummary,
  UpdateTimeEntryInput
} from "@orion/shared-types";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/** Same window the API takes (`from`/`to` are ISO instants; `taskId`/`projectId` narrow it further). */
export interface TimeEntryFilters {
  from?: string;
  to?: string;
  taskId?: string;
  projectId?: string;
}

/**
 * Cursor-paginated entries of a window, newest first (S15 — replaces the old
 * flat `take: 500` response, which silently truncated past 500 rows with no
 * way to see more). `fetchNextPage`/`hasNextPage` follow `TanStack Query`'s
 * usual infinite-query shape; `entries` flattens every loaded page for the
 * panel's grouping/rendering. Use `useTimeEntriesSummary` for exact totals —
 * never sum `entries`, it only reflects pages loaded so far.
 */
export function useTimeEntries(workspaceId: string | undefined, filters?: TimeEntryFilters) {
  const { api } = useCore();
  const query = useInfiniteQuery<TimeEntryPage>({
    queryKey: ["time", workspaceId, filters],
    queryFn: ({ pageParam }) =>
      api.listTimeEntries(workspaceId as string, { ...filters, cursor: pageParam as string | undefined }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(workspaceId)
  });
  const entries = query.data?.pages.flatMap((page) => page.items) ?? [];
  return { ...query, entries };
}

/**
 * Exact total minutes/count for a filter set — a real server-side aggregate
 * (`SUM`/`COUNT`), correct regardless of how many pages `useTimeEntries` has
 * loaded (S15).
 */
export function useTimeEntriesSummary(workspaceId: string | undefined, filters?: TimeEntryFilters) {
  const { api } = useCore();
  return useQuery<TimeSummary>({
    queryKey: ["time-summary", workspaceId, filters],
    queryFn: () => api.timeEntriesSummary(workspaceId as string, filters),
    enabled: Boolean(workspaceId)
  });
}

/**
 * The running entry (or `null`). Polled once a minute **only** to notice that a
 * timer was started or stopped elsewhere (another tab, another device): the
 * displayed duration is ticked locally from `startedAt` with `entryMinutes`, so
 * a per-second request would buy nothing.
 */
export function useRunningTimer(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<TimeEntry | null>({
    queryKey: ["time-running", workspaceId],
    queryFn: () => api.runningTimeEntry(workspaceId as string),
    enabled: Boolean(workspaceId),
    refetchInterval: 60_000,
    staleTime: 30_000
  });
}

/**
 * Both keys travel together: every mutation changes what the list shows (a new
 * entry, a stopped timer) *and* what the widget shows, and the two live under
 * different prefixes (`["time"]` / `["time-running"]`).
 */
function useInvalidateTime(workspaceId: string | undefined): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["time", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["time-summary", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["time-running", workspaceId] });
  };
}

export function useStartTimer(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateTime(workspaceId);
  return useMutation({
    mutationFn: (input: StartTimerInput) => api.startTimer(workspaceId as string, input),
    onSuccess: invalidate
  });
}

export function useStopTimer(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateTime(workspaceId);
  return useMutation({
    mutationFn: (input: StopTimerInput = {}) => api.stopTimer(workspaceId as string, input),
    onSuccess: invalidate
  });
}

export function useCreateTimeEntry(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateTime(workspaceId);
  return useMutation({
    mutationFn: (input: CreateTimeEntryInput) => api.createTimeEntry(workspaceId as string, input),
    onSuccess: invalidate
  });
}

export function useUpdateTimeEntry(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateTime(workspaceId);
  return useMutation({
    mutationFn: ({ entryId, input }: { entryId: string; input: UpdateTimeEntryInput }) =>
      api.updateTimeEntry(workspaceId as string, entryId, input),
    onSuccess: invalidate
  });
}

export function useDeleteTimeEntry(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateTime(workspaceId);
  return useMutation({
    mutationFn: (entryId: string) => api.deleteTimeEntry(workspaceId as string, entryId),
    onSuccess: invalidate
  });
}

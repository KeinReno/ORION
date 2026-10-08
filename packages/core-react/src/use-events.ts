"use client";

import type { CalendarFeedInfo, CreateEventInput, Event, EventScope, UpdateEventInput } from "@orion/shared-types";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export interface EventRange {
  /** ISO instant, inclusive lower bound of the visible window. */
  from: string;
  /** ISO instant, exclusive upper bound. */
  to: string;
}

interface ScopedEventVars {
  eventId: string;
  input: UpdateEventInput;
  scope?: EventScope;
  occurrenceStart?: string;
}

/**
 * The calendar is the one ORION list that queries a server-side window (see
 * EventsService.list) — each distinct `range` is its own cached query, so
 * pass a range that only changes when the visible period does.
 */
export function useEvents(workspaceId: string | undefined, range: EventRange | undefined) {
  const { api } = useCore();
  return useQuery<Event[]>({
    queryKey: ["events", workspaceId, range?.from ?? "", range?.to ?? ""],
    queryFn: () => api.listEvents(workspaceId as string, (range as EventRange).from, (range as EventRange).to),
    enabled: Boolean(workspaceId && range),
    // Смена месяца меняет ключ окна. Без предыдущих данных `isLoading` снова
    // становится true, панель подменяет календарь скелетоном и он монтируется
    // заново на сегодняшней дате — выбранный месяц «откатывался» к текущему.
    placeholderData: keepPreviousData
  });
}

export function useCreateEvent(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) => api.createEvent(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["events", workspaceId] })
  });
}

/**
 * Optimistic: patches every cached `["events", workspaceId, …]` window in
 * place before the request resolves, so a drag-to-reschedule lands
 * instantly and rolls back on error. The panel layers "Отменить" on top by
 * issuing the inverse update.
 */
export function useUpdateEvent(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, input, scope, occurrenceStart }: ScopedEventVars) =>
      api.updateEvent(workspaceId as string, eventId, input, { scope, occurrenceStart }),
    onMutate: async ({ eventId, input }) => {
      await queryClient.cancelQueries({ queryKey: ["events", workspaceId] });
      const snapshot = queryClient.getQueriesData<Event[]>({ queryKey: ["events", workspaceId] });
      for (const [key, list] of snapshot) {
        if (!list) continue;
        queryClient.setQueryData<Event[]>(
          key,
          list.map((ev) => (ev.id === eventId ? { ...ev, ...stripUndefined(input) } : ev))
        );
      }
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      for (const [key, list] of context?.snapshot ?? []) queryClient.setQueryData(key, list);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["events", workspaceId] })
  });
}

export function useDeleteEvent(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      eventId,
      scope,
      occurrenceStart
    }: {
      eventId: string;
      scope?: EventScope;
      occurrenceStart?: string;
    }) => api.deleteEvent(workspaceId as string, eventId, { scope, occurrenceStart }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["events", workspaceId] })
  });
}

export function useCalendarFeed(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<CalendarFeedInfo>({
    queryKey: ["calendar-feed", workspaceId],
    queryFn: () => api.calendarFeedInfo(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useRotateCalendarFeed(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.rotateCalendarFeed(workspaceId as string),
    onSuccess: (info) => queryClient.setQueryData(["calendar-feed", workspaceId], info)
  });
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

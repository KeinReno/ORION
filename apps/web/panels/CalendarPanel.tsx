"use client";

import {
  useCalendarFeed,
  useCreateEvent,
  useDeleteEvent,
  useEvents,
  useNotes,
  useProjects,
  useRecurringTransactions,
  useRotateCalendarFeed,
  useTasks,
  useUpdateEvent,
  useUpdateTask,
  type EventRange
} from "@orion/core-react";
import type { CreateEventInput, Event, EventScope, UpdateEventInput } from "@orion/shared-types";
import {
  Button,
  Calendar,
  EmptyState,
  IconButton,
  Modal,
  PanelBody,
  PanelHeader,
  PanelShell,
  Sheet,
  Skeleton,
  calendarItemMode,
  isTypingTarget,
  useEscapeKey,
  useMounted,
  usePanelVisible,
  useToast,
  toneStyle,
  type CalendarItem,
  type ReschedulePayload,
  type SlotCreatePayload
} from "@orion/ui";
import { CalendarDays, CircleHelp, Plus, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { nextListId } from "../lib/list-nav";
import { describeAuthError, describeError } from "../lib/error-message";
import {
  CALENDAR_SOURCES,
  CALENDAR_SOURCE_MODULE,
  eventItems,
  financeItems,
  noteItems,
  taskItems,
  type CalendarSourceId
} from "../lib/calendar-sources";
import { focusNote, focusTask, openPanel, useFocusedEventId } from "../lib/panel-bus";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { EventForm, type EventFormValues } from "./event-form";
import { CalendarConnectionsButton } from "./calendar-connections";

const SOURCES_KEY = "orion.calendar.sources";

const SCOPE_OPTIONS: [EventScope, string][] = [
  ["one", "Это событие"],
  ["following", "Это и последующие"],
  ["all", "Все"]
];

function loadEnabledSources(): Set<CalendarSourceId> {
  try {
    const raw = localStorage.getItem(SOURCES_KEY);
    if (raw) return new Set(JSON.parse(raw) as CalendarSourceId[]);
  } catch {
    /* ignore */
  }
  return new Set(CALENDAR_SOURCES.map((s) => s.id));
}

/** `<masterId>:<iso>` from the windowed list → the pieces a scoped edit needs. */
function splitOccurrenceId(id: string): { masterId: string; occurrenceStart?: string } {
  const colon = id.indexOf(":");
  return colon > -1 ? { masterId: id.slice(0, colon), occurrenceStart: id.slice(colon + 1) } : { masterId: id };
}

function toCreateInput(v: EventFormValues): CreateEventInput {
  return {
    title: v.title,
    description: v.description,
    location: v.location,
    url: v.url,
    startAt: v.startAt,
    endAt: v.endAt,
    allDay: v.allDay,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    colorTag: v.colorTag,
    recurrence: v.recurrence,
    reminders: v.reminders,
    projectId: v.projectId
  };
}

function isRecurring(event: Event): boolean {
  return Boolean(event.recurringEventId || event.recurrence);
}

function shiftIso(iso: string, days: number, hours: number): string {
  const next = new Date(iso);
  if (days) next.setDate(next.getDate() + days);
  if (hours) next.setHours(next.getHours() + hours);
  return next.toISOString();
}

function keyboardReschedule(item: CalendarItem, days: number, hours: number): ReschedulePayload {
  const hourShift = item.allDay ? 0 : hours;
  return {
    start: shiftIso(item.start, days, hourShift),
    end: item.end ? shiftIso(item.end, days, hourShift) : undefined,
    allDay: item.allDay
  };
}

function dropOrigin(payload: ReschedulePayload): { x: number; y: number } {
  return {
    x: payload.originX ?? window.innerWidth / 2,
    y: payload.originY ?? window.innerHeight / 3
  };
}

function initialEventRange(): EventRange {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  from.setDate(from.getDate() - 14);
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

type PendingScope =
  | { mode: "reschedule"; event: Event; payload: ReschedulePayload; origin: { x: number; y: number } }
  | { mode: "save"; values: EventFormValues; origin: { x: number; y: number } }
  | { mode: "delete"; origin: { x: number; y: number } };

export function CalendarPanel(): React.ReactElement {
  const panelVisible = usePanelVisible();
  const { workspace } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  const wsId = workspace?.id;
  const tasksOn = isEnabled("tasks");
  const notesOn = isEnabled("notes");
  const financeOn = isEnabled("finance");
  const projectsOn = isEnabled("projects");

  const [range, setRange] = useState<EventRange | undefined>(initialEventRange);
  const eventsQuery = useEvents(wsId, range);
  const tasksQuery = useTasks(tasksOn ? wsId : undefined);
  const notesQuery = useNotes(notesOn ? wsId : undefined);
  const recurringQuery = useRecurringTransactions(financeOn ? wsId : undefined);
  const { data: projectList } = useProjects(projectsOn ? wsId : undefined);

  const events = eventsQuery.data;
  const tasks = tasksQuery.data;
  const notes = notesQuery.data;
  const recurring = recurringQuery.data;

  const createEvent = useCreateEvent(wsId);
  const updateEvent = useUpdateEvent(wsId);
  const deleteEvent = useDeleteEvent(wsId);
  const updateTask = useUpdateTask(wsId);
  const feed = useCalendarFeed(wsId);
  const rotateFeed = useRotateCalendarFeed(wsId);
  const { toast } = useToast();

  const [enabled, setEnabled] = useState<Set<CalendarSourceId>>(() => new Set());
  useEffect(() => setEnabled(loadEnabledSources()), []);
  function toggleSource(id: CalendarSourceId): void {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(SOURCES_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const items: CalendarItem[] = useMemo(() => {
    const out: CalendarItem[] = [];
    if (enabled.has("events")) out.push(...eventItems(events));
    if (enabled.has("tasks")) out.push(...taskItems(tasks));
    if (enabled.has("notes")) out.push(...noteItems(notes));
    if (enabled.has("finance")) out.push(...financeItems(recurring));
    return out;
  }, [enabled, events, tasks, notes, recurring]);

  const sourceQueries = [
    eventsQuery,
    ...(tasksOn ? [tasksQuery] : []),
    ...(notesOn ? [notesQuery] : []),
    ...(financeOn ? [recurringQuery] : [])
  ];
  const sourcesLoading = sourceQueries.some((query) => query.isLoading);
  const failedQueries = sourceQueries.filter((query) => query.isError);
  const sourcesError = failedQueries[0]?.error;

  const [newSlot, setNewSlot] = useState<SlotCreatePayload | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [selected, setSelected] = useState<Event | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIdRef = useRef<string | null>(null);
  focusedIdRef.current = focusedId;
  const [pendingScope, setPendingScope] = useState<PendingScope | null>(null);
  const focusedEventId = useFocusedEventId();

  useEffect(() => {
    if (!focusedEventId) return;
    const event = (events ?? []).find((item) => item.id === focusedEventId);
    if (!event) return;
    setSelected(event);
  }, [focusedEventId, events]);

  function findEvent(id: string): Event | undefined {
    return (events ?? []).find((e) => e.id === id);
  }

  function openItem(id: string): void {
    setFocusedId(id);
    const event = findEvent(id);
    if (event) {
      setSelected(event);
      return;
    }
    if ((tasks ?? []).some((t) => t.id === id)) focusTask(id);
    else if ((notes ?? []).some((n) => n.id === id)) focusNote(id);
    else openPanel("finance");
  }

  function applyEventReschedule(event: Event, payload: ReschedulePayload, editScope: EventScope): void {
    const { masterId, occurrenceStart } = splitOccurrenceId(event.id);
    const patch: UpdateEventInput = { startAt: payload.start, endAt: payload.end, allDay: payload.allDay };
    const prevStart = event.startAt;
    const prevEnd = event.endAt;
    updateEvent.mutate(
      { eventId: masterId, input: patch, scope: editScope, occurrenceStart },
      {
        onSuccess: () =>
          toast({
            title: "Событие перенесено",
            tone: "success",
            action: {
              label: "Отменить",
              onClick: () =>
                updateEvent.mutate({
                  eventId: masterId,
                  input: { startAt: prevStart, endAt: prevEnd },
                  scope: editScope,
                  occurrenceStart
                })
            }
          })
      }
    );
  }

  function reschedule(id: string, payload: ReschedulePayload): void {
    const event = findEvent(id);
    if (event) {
      if (event.readOnly) return;
      if (isRecurring(event)) {
        setPendingScope({ mode: "reschedule", event, payload, origin: dropOrigin(payload) });
        return;
      }
      applyEventReschedule(event, payload, "all");
      return;
    }
    if ((tasks ?? []).some((t) => t.id === id)) {
      updateTask.mutate(
        { taskId: id, input: { dueAt: payload.start } },
        { onSuccess: () => toast({ title: "Срок перенесён", tone: "success" }) }
      );
    }
  }

  const sortedItemIds = useMemo(
    () => [...items].sort((a, b) => a.start.localeCompare(b.start)).map((item) => item.id),
    [items]
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!panelVisible || selected || newSlot || pendingScope) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (event.shiftKey) {
          const item = items.find((entry) => entry.id === focusedIdRef.current);
          if (!item || calendarItemMode(item) === "none") return;
          event.preventDefault();
          reschedule(item.id, keyboardReschedule(item, 0, event.key === "ArrowDown" ? 1 : -1));
          return;
        }
        event.preventDefault();
        const next = nextListId(sortedItemIds, focusedIdRef.current, event.key === "ArrowDown" ? 1 : -1);
        if (next) {
          focusedIdRef.current = next;
          setFocusedId(next);
        }
        return;
      }
      if (event.key === "Enter" && focusedIdRef.current) {
        event.preventDefault();
        openItem(focusedIdRef.current);
        return;
      }
      if (!event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      const item = items.find((entry) => entry.id === focusedIdRef.current);
      if (!item || calendarItemMode(item) === "none") return;
      event.preventDefault();
      reschedule(item.id, keyboardReschedule(item, event.key === "ArrowRight" ? 1 : -1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelVisible, selected, newSlot, pendingScope, items, focusedId, sortedItemIds]);

  async function create(values: EventFormValues): Promise<void> {
    try {
      await createEvent.mutateAsync(toCreateInput(values));
      setNewSlot(null);
      toast({ title: "Событие создано", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось создать событие", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function commitSave(values: EventFormValues, scope: EventScope): Promise<void> {
    if (!selected) return;
    const { masterId, occurrenceStart } = splitOccurrenceId(selected.id);
    const input: UpdateEventInput = {
      title: values.title,
      description: values.description,
      location: values.location,
      url: values.url,
      startAt: values.startAt,
      endAt: values.endAt,
      allDay: values.allDay,
      colorTag: values.colorTag,
      recurrence: values.recurrence,
      reminders: values.reminders,
      projectId: values.projectId
    };
    try {
      await updateEvent.mutateAsync({
        eventId: masterId,
        input,
        scope: isRecurring(selected) ? scope : "all",
        occurrenceStart
      });
      setSelected(null);
      toast({ title: "Сохранено", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить событие", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function saveSelected(values: EventFormValues): Promise<void> {
    if (!selected) return;
    if (isRecurring(selected)) {
      setPendingScope({
        mode: "save",
        values,
        origin: { x: window.innerWidth / 2, y: window.innerHeight / 3 }
      });
      return;
    }
    await commitSave(values, "all");
  }

  async function commitDelete(scope: EventScope): Promise<void> {
    if (!selected) return;
    const { masterId, occurrenceStart } = splitOccurrenceId(selected.id);
    try {
      await deleteEvent.mutateAsync({
        eventId: masterId,
        scope: isRecurring(selected) ? scope : "all",
        occurrenceStart
      });
      setSelected(null);
      toast({ title: "Событие удалено", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось удалить событие", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function removeSelected(): Promise<void> {
    if (!selected) return;
    if (isRecurring(selected)) {
      setPendingScope({
        mode: "delete",
        origin: { x: window.innerWidth / 2, y: window.innerHeight / 3 }
      });
      return;
    }
    await commitDelete("all");
  }

  function pickScope(scope: EventScope): void {
    const pending = pendingScope;
    setPendingScope(null);
    if (!pending) return;
    if (pending.mode === "reschedule") applyEventReschedule(pending.event, pending.payload, scope);
    else if (pending.mode === "save") void commitSave(pending.values, scope);
    else void commitDelete(scope);
  }

  function retrySources(): void {
    for (const query of failedQueries) void query.refetch();
  }

  return (
    <PanelShell>
      <PanelHeader
        icon={CalendarDays}
        title="Календарь"
        subtitle={`${items.length} на экране`}
        actions={
          <>
            <IconButton
              label="Как пользоваться календарём"
              size="sm"
              aria-controls="calendar-help"
              aria-expanded={showHelp}
              onClick={() => setShowHelp((value) => !value)}
            >
              <CircleHelp className="h-4 w-4" />
            </IconButton>
            <Button size="sm" onClick={() => setNewSlot({ start: new Date().toISOString(), allDay: false })}>
              <Plus className="h-4 w-4" /> Событие
            </Button>
          </>
        }
      />
      <PanelBody>
        {failedQueries.length > 0 ? (
          <EmptyState
            icon={TriangleAlert}
            tone="danger"
            title="Не удалось загрузить «Календарь»"
            description={describeError(sourcesError)}
            action={
              <Button size="sm" variant="outline" onClick={retrySources}>
                Повторить
              </Button>
            }
          />
        ) : sourcesLoading ? (
          <CalendarSkeleton />
        ) : (
          <>
            <Calendar
              items={items}
              onRangeChange={setRange}
              onItemClick={openItem}
              onItemReschedule={reschedule}
              onSlotCreate={setNewSlot}
              focusedId={focusedId}
              headerExtra={
                <div className="flex flex-wrap items-center gap-1">
                  {CALENDAR_SOURCES.filter((source) => {
                    const moduleId = CALENDAR_SOURCE_MODULE[source.id];
                    return !moduleId || isEnabled(moduleId);
                  }).map((source) => {
                    const on = enabled.has(source.id);
                    return (
                      <button
                        key={source.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleSource(source.id)}
                        style={toneStyle(source.toneKey)}
                        className={`rounded-full border px-2 py-0.5 text-micro font-medium transition-opacity ${
                          on ? "opacity-100" : "opacity-40"
                        }`}
                      >
                        <span
                          aria-hidden
                          className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                          style={{ background: on ? "currentColor" : "transparent", boxShadow: "inset 0 0 0 1px currentColor" }}
                        />
                        {source.label}
                      </button>
                    );
                  })}
                  <CalendarConnectionsButton
                    feedUrl={feed.data?.url}
                    onRotateFeed={() =>
                      rotateFeed.mutate(undefined, {
                        onSuccess: () =>
                          toast({ title: "Ссылка обновлена, старая больше не работает", tone: "success" })
                      })
                    }
                  />
                </div>
              }
            />
            <p id="calendar-help" hidden={!showHelp} className="text-micro text-subtle-foreground">
              Клик по пустому месту — новое событие. Тяните за середину, чтобы перенести, за нижний край — изменить
              длительность. Задачи — точка без длины. Клавиши: ← → период, T сегодня, 1–4 виды.
            </p>
          </>
        )}
      </PanelBody>

      <Modal open={newSlot !== null} onClose={() => setNewSlot(null)} title="Новое событие" size="md">
        <EventForm
          key={newSlot ? newSlot.start : "none"}
          defaultStart={newSlot?.start}
          defaultEnd={newSlot?.end}
          defaultAllDay={newSlot?.allDay}
          projects={projectsOn ? (projectList ?? []) : undefined}
          busy={createEvent.isPending}
          submitLabel="Создать"
          onCancel={() => setNewSlot(null)}
          onSubmit={create}
        />
      </Modal>

      <Sheet open={selected !== null} onClose={() => setSelected(null)} title="Событие">
        {selected ? (
          <EventForm
            key={selected.id}
            initial={selected}
            projects={projectsOn ? (projectList ?? []) : undefined}
            busy={updateEvent.isPending || deleteEvent.isPending}
            submitLabel="Сохранить"
            onCancel={() => setSelected(null)}
            onSubmit={saveSelected}
            onDelete={removeSelected}
          />
        ) : null}
      </Sheet>

      {pendingScope ? (
        <EventScopePopover origin={pendingScope.origin} onPick={pickScope} onClose={() => setPendingScope(null)} />
      ) : null}
    </PanelShell>
  );
}

function EventScopePopover({
  origin,
  onPick,
  onClose
}: {
  origin: { x: number; y: number };
  onPick: (scope: EventScope) => void;
  onClose: () => void;
}): React.ReactElement | null {
  const mounted = useMounted();
  useEscapeKey(onClose, true);
  const width = 220;
  const left = Math.max(8, Math.min(origin.x, window.innerWidth - width - 8));
  const top = Math.min(origin.y + 6, window.innerHeight - 8);

  if (!mounted) return null;
  return createPortal(
    <>
      <button type="button" aria-label="Закрыть" className="fixed inset-0 z-[110] cursor-default bg-black/20" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Что изменить"
        className="fixed z-[111] overflow-hidden rounded-xl border border-border bg-card/90 p-3 shadow-xl shadow-black/40 backdrop-blur-md"
        style={{ top, left, width }}
      >
        <p className="mb-1 text-micro text-subtle-foreground">Что изменить</p>
        <div className="flex flex-col gap-1">
          {SCOPE_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="rounded-lg px-2 py-1.5 text-left text-label text-foreground hover:bg-white/5"
              onClick={() => onPick(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </>,
    document.body
  );
}

function CalendarSkeleton(): React.ReactElement {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 35 }).map((_, i) => (
          <Skeleton key={i} className="min-h-[80px] w-full" />
        ))}
      </div>
    </div>
  );
}

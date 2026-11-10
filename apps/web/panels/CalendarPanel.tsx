"use client";

import {
  useContactCards,
  useCreateEvent,
  useCreateNote,
  useCreateTask,
  useDeleteEvent,
  useEvents,
  useNotes,
  useProjects,
  useRecurringTransactions,
  useTasks,
  useUpdateEvent,
  useUpdateTask,
  useCore,
  type EventRange
} from "@orion/core-react";
import type { CreateEventInput, Event, EventScope, UpdateEventInput } from "@orion/shared-types";
import {
  Button,
  Calendar,
  DropdownMenu,
  EmptyState,
  IconButton,
  Input,
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
import { CalendarDays, ChevronDown, CircleHelp, FileText, ListTodo, Plus, Search, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { eventReschedulePatch, shiftAllDayIso } from "../lib/calendar-reschedule";
import { fromDatetimeLocal, toDatetimeLocal } from "../lib/format";
import { nextListId } from "../lib/list-nav";
import { describeAuthError, describeError } from "../lib/error-message";
import {
  CALENDAR_SOURCES,
  CALENDAR_SOURCE_MODULE,
  eventItems,
  birthdayItems,
  contactIdFromBirthdayItem,
  financeItems,
  noteItems,
  taskItems,
  type CalendarSourceId
} from "../lib/calendar-sources";
import { openEntity, openPanel, useEventFocusRequest } from "../lib/panel-bus";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { EventForm, type EventFormValues } from "./event-form";
import { ExtensionSlot } from "../lib/extensions/slot";
import { ObjectOpenMenu } from "../components/object-open-menu";
import { useViewState } from "../lib/use-view-state";
import { calendarViewStateSchema } from "@orion/shared-types";
import { ObjectOpenPopup } from "../components/object-open-popup";

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
  if (item.allDay) {
    // Whole UTC days — see shiftAllDayIso (a local setDate across a DST
    // switch would knock the UTC-midnight anchor off its date).
    return {
      start: shiftAllDayIso(item.start, days),
      end: item.end ? shiftAllDayIso(item.end, days) : undefined,
      allDay: true
    };
  }
  return {
    start: shiftIso(item.start, days, hours),
    end: item.end ? shiftIso(item.end, days, hours) : undefined,
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
  const { api } = useCore();
  const panelVisible = usePanelVisible();
  const { workspace } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  const wsId = workspace?.id;
  const tasksOn = isEnabled("tasks");
  const notesOn = isEnabled("notes");
  const financeOn = isEnabled("finance");
  const projectsOn = isEnabled("projects");
  const contactsOn = isEnabled("contacts");

  const [range, setRange] = useState<EventRange | undefined>(initialEventRange);
  const eventsQuery = useEvents(wsId, range);
  const tasksQuery = useTasks(tasksOn ? wsId : undefined);
  const notesQuery = useNotes(notesOn ? wsId : undefined);
  const recurringQuery = useRecurringTransactions(financeOn ? wsId : undefined);
  const { data: projectList } = useProjects(projectsOn ? wsId : undefined);
  const contactsQuery = useContactCards(contactsOn ? wsId : undefined);

  const events = eventsQuery.data;
  const tasks = tasksQuery.data;
  const notes = notesQuery.data;
  const recurring = recurringQuery.data;
  const contacts = contactsQuery.data;

  const createEvent = useCreateEvent(wsId);
  const updateEvent = useUpdateEvent(wsId);
  const deleteEvent = useDeleteEvent(wsId);
  const updateTask = useUpdateTask(wsId);
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

  const allItems: CalendarItem[] = useMemo(() => {
    const out: CalendarItem[] = [];
    if (enabled.has("events")) out.push(...eventItems(events));
    if (enabled.has("tasks")) out.push(...taskItems(tasks));
    if (enabled.has("notes")) out.push(...noteItems(notes));
    if (enabled.has("finance")) out.push(...financeItems(recurring));
    if (enabled.has("contacts")) out.push(...birthdayItems(contacts, range));
    return out;
  }, [enabled, events, tasks, notes, recurring, contacts, range]);

  // Search narrows what is drawn, never what is loaded: clearing it brings everything back.
  const [filter, setFilter] = useState("");
  const items: CalendarItem[] = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? allItems.filter((item) => item.label.toLowerCase().includes(needle)) : allItems;
  }, [allItems, filter]);

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
  // Tasks and notes are created through their own modules' API — never as a second Event.
  const [quick, setQuick] = useState<"task" | "note" | null>(null);
  const createTask = useCreateTask(tasksOn ? wsId : undefined);
  const createNote = useCreateNote(notesOn ? wsId : undefined);
  const [selected, setSelected] = useState<Event | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Grid views (month/week/day) have no room for a per-item button: right click / Menu key / Shift+F10.
  const [calendarView, setCalendarView] = useState<"month" | "week" | "day" | "agenda">("month");
  useViewState("calendar", calendarViewStateSchema, wsId, { view: calendarView }, (saved) => setCalendarView(saved.view));
  const visibleSources = CALENDAR_SOURCES.filter((source) => {
    const moduleId = CALENDAR_SOURCE_MODULE[source.id];
    return !moduleId || isEnabled(moduleId);
  });
  const sourceCount = { on: visibleSources.filter((source) => enabled.has(source.id)).length, total: visibleSources.length };
  const sourceChips = visibleSources.map((source) => {
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
  });
  const [gridMenu, setGridMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const focusedIdRef = useRef<string | null>(null);
  focusedIdRef.current = focusedId;
  const [pendingScope, setPendingScope] = useState<PendingScope | null>(null);
  const eventFocus = useEventFocusRequest();

  useEffect(() => {
    if (!eventFocus || eventFocus.workspaceId !== wsId) return;
    const event = (events ?? []).find((item) => item.id === eventFocus.id);
    if (event) {
      setSelected(event);
      return;
    }
    if (!wsId || eventsQuery.isLoading) return;
    let cancelled = false;
    void api.getEvent(wsId, eventFocus.id).then(
      (record) => { if (!cancelled) setSelected(record); },
      (error) => { if (!cancelled) toast({ title: "Не удалось открыть событие", description: describeAuthError(error), tone: "danger" }); }
    );
    return () => { cancelled = true; };
  }, [api, eventFocus, events, eventsQuery.isLoading, wsId, toast]);

  const findEvent = useCallback((id: string): Event | undefined => {
    return (events ?? []).find((e) => e.id === id);
  }, [events]);

  const openItem = useCallback((id: string): void => {
    setFocusedId(id);
    const birthdayContactId = contactIdFromBirthdayItem(id);
    if (birthdayContactId) {
      openEntity("contact", birthdayContactId);
      return;
    }
    const event = findEvent(id);
    if (event) {
      setSelected(event);
      return;
    }
    if ((tasks ?? []).some((t) => t.id === id)) openEntity("task", id);
    else if ((notes ?? []).some((n) => n.id === id)) openEntity("note", id);
    else openPanel("finance");
  }, [findEvent, tasks, notes]);

  const applyEventReschedule = useCallback((event: Event, payload: ReschedulePayload, editScope: EventScope): void => {
    const { masterId, occurrenceStart } = splitOccurrenceId(event.id);
    // Month-grid drops carry only the target day; `eventReschedulePatch`
    // keeps the event's length, time of day and all-day date-only contract.
    const patch: UpdateEventInput = eventReschedulePatch(event, payload);
    const prevStart = event.startAt;
    const prevEnd = event.endAt;
    const prevAllDay = event.allDay;
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
                  input: { startAt: prevStart, endAt: prevEnd, allDay: prevAllDay },
                  scope: editScope,
                  occurrenceStart
                })
            }
          })
      }
    );
  }, [updateEvent, toast]);

  const reschedule = useCallback((id: string, payload: ReschedulePayload): void => {
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
  }, [findEvent, applyEventReschedule, updateTask, toast, tasks]);

  const sortedItemIds = useMemo(
    () => [...items].sort((a, b) => a.start.localeCompare(b.start)).map((item) => item.id),
    [items]
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!panelVisible || selected || newSlot || pendingScope) return;
      if (isTypingTarget(event.target)) return;
      // Controls and object-opening menus own their keys; don't navigate or
      // reschedule the focused calendar item while the user operates them.
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest("button, a, [role=menu], [role=tablist]"))) return;
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
  }, [panelVisible, selected, newSlot, pendingScope, items, focusedId, sortedItemIds, openItem, reschedule]);

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
        subtitle={filter.trim() ? `${items.length} из ${allItems.length} на экране` : `${items.length} на экране`}
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
            {tasksOn || notesOn ? (
              <DropdownMenu
                align="end"
                trigger={({ toggle }) => (
                  <Button size="sm" variant="outline" onClick={toggle} aria-label="Создать задачу или заметку">
                    <Plus className="h-4 w-4" /> {tasksOn && notesOn ? "Задача / заметка" : tasksOn ? "Задача" : "Заметка"}
                  </Button>
                )}
                items={[
                  ...(tasksOn ? [{ label: "Задачу со сроком…", icon: ListTodo, onSelect: () => setQuick("task") }] : []),
                  ...(notesOn ? [{ label: "Заметку на дату…", icon: FileText, onSelect: () => setQuick("note") }] : [])
                ]}
              />
            ) : null}
          </>
        }
      >
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Найти на календаре"
            aria-label="Найти на календаре"
            className="pl-8"
          />
        </div>
      </PanelHeader>
      <PanelBody className="flex flex-col">
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
            {gridMenu ? (() => {
              const item = items.find(candidate => candidate.id === gridMenu.id);
              return item && (item.kind === "task" || item.kind === "note")
                ? <ObjectOpenPopup view={{ object: { workspaceId: wsId ?? "", entityType: item.kind, entityId: item.id }, viewId: "detail" }} title={item.label} at={gridMenu} onClose={() => setGridMenu(null)} />
                : null;
            })() : null}
            <Calendar
              items={items}
              view={calendarView}
              onViewChange={setCalendarView}
              renderAgendaItemActions={item => {
                if (item.kind !== "task" && item.kind !== "note") return null;
                if ((item.kind === "task" && !tasksOn) || (item.kind === "note" && !notesOn)) return null;
                return <ObjectOpenMenu view={{ object: { workspaceId: wsId ?? "", entityType: item.kind, entityId: item.id }, viewId: "detail" }} title={item.label} />;
              }}
              onRangeChange={setRange}
              onItemClick={openItem}
              onItemContextMenu={(id, at) => {
                const item = items.find(candidate => candidate.id === id);
                if (!item || (item.kind !== "task" && item.kind !== "note")) return;
                if ((item.kind === "task" && !tasksOn) || (item.kind === "note" && !notesOn)) return;
                setGridMenu({ id, ...at });
              }}
              onItemReschedule={reschedule}
              onSlotCreate={setNewSlot}
              focusedId={focusedId}
              headerExtra={
                <div className="flex flex-wrap items-center gap-1">
                  {/* Wide: the source chips sit inline. Narrow: one disclosure, so the grid starts above the fold. */}
                  <div className="hidden flex-wrap items-center gap-1 sm:flex">{sourceChips}</div>
                  <details className="group w-full sm:hidden">
                    <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-border px-2.5 text-label text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 [&::-webkit-details-marker]:hidden">
                      <span className="flex-1">Источники · {sourceCount.on} из {sourceCount.total}</span>
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <div className="mt-2 flex flex-wrap items-center gap-1">{sourceChips}</div>
                  </details>
                  <ExtensionSlot name="calendar.toolbar" props={{ workspaceId: wsId }} />
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

      <Modal open={quick !== null} onClose={() => setQuick(null)} title={quick === "task" ? "Новая задача" : "Новая заметка"} size="sm">
        {quick ? (
          <QuickCreateForm
            key={quick}
            kind={quick}
            busy={createTask.isPending || createNote.isPending}
            onCancel={() => setQuick(null)}
            onSubmit={async (title, whenIso) => {
              try {
                if (quick === "task") await createTask.mutateAsync({ title, description: "", priority: "normal", dueAt: whenIso, checklist: [] });
                else await createNote.mutateAsync({ title, body: "", tags: [], eventAt: whenIso });
                setQuick(null);
                toast({ title: quick === "task" ? "Задача создана" : "Заметка создана", tone: "success" });
              } catch (error) {
                toast({ title: "Не удалось создать", description: describeError(error), tone: "danger" });
              }
            }}
          />
        ) : null}
      </Modal>

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

/** Title + date for a task or a note placed straight onto the calendar. The date is required: that is the point. */
function QuickCreateForm({
  kind,
  busy,
  onCancel,
  onSubmit
}: {
  kind: "task" | "note";
  busy: boolean;
  onCancel: () => void;
  onSubmit: (title: string, whenIso: string) => void | Promise<void>;
}): React.ReactElement {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(() => {
    const next = new Date();
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return toDatetimeLocal(next.toISOString());
  });
  const whenIso = fromDatetimeLocal(when);
  const ready = title.trim().length > 0 && whenIso !== null;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && whenIso) void onSubmit(title.trim(), whenIso);
      }}
    >
      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название" aria-label="Название" autoFocus required />
      <label className="flex flex-col gap-1 text-label text-subtle-foreground">
        {kind === "task" ? "Срок" : "Показать в календаре"}
        <Input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} required />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy || !ready}>
          Создать
        </Button>
      </div>
    </form>
  );
}

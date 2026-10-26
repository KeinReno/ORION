"use client";

import { ApiError } from "@orion/core";
import {
  useCaptureInboxItem,
  useCreateNote,
  useCreateTask,
  useEvents,
  useLists,
  useNote,
  useNotes,
  useTasks,
  useUpdateListItem,
  useUpdateNote,
  useUpdateTask
} from "@orion/core-react";
import {
  isTaskClosed,
  localDayDueAt,
  localDayRange,
  partitionOpenTasks,
  quickCaptureHint,
  quickCapturePlaceholder,
  resolveQuickCapture,
  type OrionModuleId,
  type Task
} from "@orion/shared-types";
import { Button, CheckToggle, EmptyState, Input, Textarea, useToast } from "@orion/ui";
import { useMemo, useState, type FormEvent } from "react";
import { useCaptureToList } from "../lib/capture-to-list";
import { describeError } from "../lib/error-message";
import { useLocalNow } from "../lib/use-day-boundary";
import type { PhoneSection } from "./phone-app";

function BlockError({ title, onRetry }: { title: string; onRetry: () => void }): React.ReactElement {
  return <EmptyState tone="danger" title={title} description="Остальные разделы на месте." action={<Button onClick={onRetry}>Повторить</Button>} />;
}

function ModuleOff({ label }: { label: string }): React.ReactElement {
  return <EmptyState title={`${label} выключены`} description="Включите модуль в ORION на компьютере: Настройки → Модули." />;
}

export function PhoneToday({
  workspaceId,
  isEnabled,
  onOpen
}: {
  workspaceId: string;
  isEnabled: (id: OrionModuleId) => boolean;
  onOpen: (section: PhoneSection) => void;
}): React.ReactElement {
  const tasksOn = isEnabled("tasks");
  const notesOn = isEnabled("notes");
  const listsOn = isEnabled("lists");
  const calendarOn = isEnabled("calendar");
  const now = useLocalNow();
  const day = useMemo(() => localDayRange(now), [now]);
  const tasks = useTasks(tasksOn ? workspaceId : undefined);
  const events = useEvents(calendarOn ? workspaceId : undefined, calendarOn ? day : undefined);
  const lists = useLists(listsOn ? workspaceId : undefined);
  const parts = useMemo(() => partitionOpenTasks(tasks.data ?? [], now, 8), [tasks.data, now]);
  const focus = [...parts.overdue, ...parts.today];
  const todayEvents = (events.data ?? []).filter((event) => event.startAt < day.to && (event.endAt ?? event.startAt) > day.from);

  return (
    <div className="space-y-6">
      <CaptureBox workspaceId={workspaceId} tasksOn={tasksOn} notesOn={notesOn} listsOn={listsOn} />
      {tasksOn ? (
        <section className="space-y-2">
          <SectionTitle title="Задачи на сегодня" action="Все" onAction={() => onOpen("tasks")} />
          {tasks.isError ? <BlockError title="Задачи не загрузились" onRetry={() => void tasks.refetch()} /> : null}
          {!tasks.isError && focus.length === 0 ? <p className="text-sm text-muted-foreground">На сегодня ничего не назначено.</p> : null}
          <TaskRows workspaceId={workspaceId} tasks={focus} />
        </section>
      ) : null}
      {calendarOn ? (
        <section className="space-y-2">
          <SectionTitle title="События" action="Календарь" onAction={() => onOpen("calendar")} />
          {events.isError ? <BlockError title="Календарь не загрузился" onRetry={() => void events.refetch()} /> : null}
          {!events.isError && todayEvents.length === 0 ? <p className="text-sm text-muted-foreground">Сегодня событий нет.</p> : null}
          <EventRows events={todayEvents} />
        </section>
      ) : null}
      {listsOn ? (
        <section className="space-y-2">
          <SectionTitle title="Списки" action="Открыть" onAction={() => onOpen("lists")} />
          <UncheckedLists lists={lists.data ?? []} />
        </section>
      ) : null}
    </div>
  );
}

function CaptureBox({
  workspaceId,
  tasksOn,
  notesOn,
  listsOn
}: {
  workspaceId: string;
  tasksOn: boolean;
  notesOn: boolean;
  listsOn: boolean;
}): React.ReactElement {
  const { toast } = useToast();
  const createTask = useCreateTask(tasksOn ? workspaceId : undefined);
  const createNote = useCreateNote(notesOn ? workspaceId : undefined);
  const captureInbox = useCaptureInboxItem(workspaceId);
  const captureToList = useCaptureToList(listsOn ? workspaceId : undefined);
  const [text, setText] = useState("");
  const preview = text.trim() ? resolveQuickCapture(text, { tasks: tasksOn, notes: notesOn, lists: listsOn }) : null;
  const hint = preview ? quickCaptureHint(preview) : null;
  const busy = createTask.isPending || createNote.isPending || captureInbox.isPending;

  async function run(value: string): Promise<void> {
    const resolved = resolveQuickCapture(value, { tasks: tasksOn, notes: notesOn, lists: listsOn });
    if (resolved.kind === "error") {
      toast({ title: resolved.message, tone: "danger" });
      return;
    }
    try {
      if (resolved.kind === "task") {
        await createTask.mutateAsync({
          title: resolved.title,
          description: "",
          dueAt: resolved.dueToday ? localDayDueAt(new Date()) : null,
          projectTag: resolved.projectTag ?? null,
          priority: "normal",
          checklist: []
        });
        toast({ title: "Задача добавлена", tone: "success" });
      } else if (resolved.kind === "note") {
        await createNote.mutateAsync({ title: resolved.title, body: "", tags: [] });
        toast({ title: "Заметка добавлена", tone: "success" });
      } else if (resolved.kind === "list") {
        const { list, added } = await captureToList(resolved.text);
        toast({ title: added > 1 ? `Добавлено в «${list.name}»: ${added}` : `Добавлено в «${list.name}»`, tone: "success" });
      } else {
        await captureInbox.mutateAsync({ title: resolved.title, body: "", kind: "inbox" });
        toast({ title: "Добавлено во входящие", tone: "success" });
      }
      setText("");
    } catch (error) {
      toast({ title: "Не сохранилось", description: describeError(error), tone: "danger" });
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    void run(text);
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm font-medium" htmlFor="phone-capture">
        Захватить
      </label>
      <Input
        id="phone-capture"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={quickCapturePlaceholder({ tasks: tasksOn, notes: notesOn, lists: listsOn })}
        autoComplete="off"
        enterKeyHint="send"
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <Button type="submit" disabled={busy || text.trim().length === 0} status={busy ? "pending" : "idle"}>
        Сохранить
      </Button>
    </form>
  );
}

function SectionTitle({ title, action, onAction }: { title: string; action: string; onAction: () => void }): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-medium">{title}</h2>
      <button type="button" className="text-sm text-muted-foreground underline-offset-2 hover:underline" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}

function TaskRows({ workspaceId, tasks }: { workspaceId: string; tasks: Task[] }): React.ReactElement | null {
  const update = useUpdateTask(workspaceId);
  const { toast } = useToast();
  if (tasks.length === 0) return null;
  return (
    <ul className="space-y-1">
      {tasks.map((task) => (
        <li key={task.id} className="flex min-h-[44px] items-center gap-2">
          <CheckToggle
            checked={task.status === "done"}
            label={task.status === "done" ? `Вернуть «${task.title}»` : `Готово «${task.title}»`}
            onClick={() => {
              const next = task.status === "done" ? "todo" : "done";
              update.mutate(
                { taskId: task.id, input: { status: next } },
                { onError: (error) => toast({ title: "Не сохранилось", description: describeError(error), tone: "danger" }) }
              );
            }}
          />
          <span className={task.status === "done" ? "text-muted-foreground line-through" : undefined}>{task.title}</span>
        </li>
      ))}
    </ul>
  );
}

function EventRows({ events }: { events: { id: string; title: string; startAt: string; allDay: boolean }[] }): React.ReactElement | null {
  if (events.length === 0) return null;
  return (
    <ul className="space-y-2">
      {events.map((event) => (
        <li key={event.id} className="flex min-h-[44px] items-baseline justify-between gap-3">
          <span>{event.title}</span>
          <time className="shrink-0 text-sm text-muted-foreground" dateTime={event.startAt}>
            {event.allDay ? "весь день" : new Date(event.startAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
          </time>
        </li>
      ))}
    </ul>
  );
}

function UncheckedLists({ lists }: { lists: { id: string; name: string; isTemplate: boolean; items: { checked: boolean }[] }[] }): React.ReactElement {
  const open = lists.filter((list) => !list.isTemplate && list.items.some((item) => !item.checked));
  if (open.length === 0) return <p className="text-sm text-muted-foreground">Неотмеченных пунктов нет.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {open.map((list) => (
        <li key={list.id}>
          {list.name}
          <span className="text-muted-foreground"> · {list.items.filter((item) => !item.checked).length}</span>
        </li>
      ))}
    </ul>
  );
}

export function PhoneTasks({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const tasks = useTasks(workspaceId);
  const open = (tasks.data ?? []).filter((task) => !isTaskClosed(task.status));
  if (!workspaceId) return <ModuleOff label="Задачи" />;
  if (tasks.isLoading) return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  if (tasks.isError) return <BlockError title="Задачи не загрузились" onRetry={() => void tasks.refetch()} />;
  if (open.length === 0) return <EmptyState title="Открытых задач нет" />;
  return <TaskRows workspaceId={workspaceId} tasks={open} />;
}

export function PhoneCalendar({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const now = useLocalNow();
  const day = useMemo(() => localDayRange(now), [now]);
  const events = useEvents(workspaceId, workspaceId ? day : undefined);
  const today = (events.data ?? []).filter((event) => event.startAt < day.to && (event.endAt ?? event.startAt) > day.from);
  if (!workspaceId) return <ModuleOff label="Календарь" />;
  if (events.isLoading) return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  if (events.isError) return <BlockError title="Календарь не загрузился" onRetry={() => void events.refetch()} />;
  if (today.length === 0) return <EmptyState title="Сегодня событий нет" description="Новое событие с телефона появится следующим шагом. Пока его можно создать на компьютере." />;
  return <EventRows events={today} />;
}

export function PhoneNotes({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const notes = useNotes(workspaceId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  if (!workspaceId) return <ModuleOff label="Заметки" />;
  if (openId) return <NoteEditor workspaceId={workspaceId} noteId={openId} onBack={() => setOpenId(null)} />;
  const filtered = (notes.data ?? []).filter((note) => note.title.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="space-y-3">
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти заметку" aria-label="Найти заметку" />
      {notes.isLoading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {notes.isError ? <BlockError title="Заметки не загрузились" onRetry={() => void notes.refetch()} /> : null}
      {!notes.isLoading && !notes.isError && filtered.length === 0 ? <EmptyState title="Заметок нет" description="«/заметка название» в захвате на экране «Сегодня» создаст первую." /> : null}
      <ul className="space-y-1">
        {filtered.map((note) => (
          <li key={note.id}>
            <button type="button" className="min-h-[44px] w-full rounded-lg px-1 text-left" onClick={() => setOpenId(note.id)}>
              {note.title || "Без названия"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoteEditor({ workspaceId, noteId, onBack }: { workspaceId: string; noteId: string; onBack: () => void }): React.ReactElement {
  const note = useNote(workspaceId, noteId);
  const update = useUpdateNote(workspaceId);
  const { toast } = useToast();
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const currentTitle = title ?? note.data?.title ?? "";
  const currentBody = body ?? note.data?.body ?? "";

  async function save(): Promise<void> {
    if (!note.data) return;
    try {
      await update.mutateAsync({
        noteId,
        input: { title: currentTitle.trim() || "Без названия", body: currentBody, expectedRevision: note.data.revision }
      });
      setTitle(null);
      setBody(null);
      toast({ title: "Заметка сохранена", tone: "success" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        toast({ title: "На узле уже новая версия", description: "Обновите заметку и внесите правку ещё раз. Поверх чужой текст не записывается.", tone: "danger" });
        return;
      }
      toast({ title: "Не сохранилось", description: describeError(error), tone: "danger" });
    }
  }

  if (note.isLoading) return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  if (note.isError || !note.data) {
    return <BlockError title="Заметка не открылась" onRetry={() => void note.refetch()} />;
  }
  return (
    <div className="space-y-3">
      <button type="button" className="min-h-[44px] text-sm text-muted-foreground" onClick={onBack}>
        К списку
      </button>
      <Input value={currentTitle} onChange={(event) => setTitle(event.target.value)} aria-label="Название" />
      <Textarea value={currentBody} onChange={(event) => setBody(event.target.value)} rows={12} aria-label="Текст заметки" />
      <div className="flex gap-2">
        <Button type="button" onClick={() => void save()} disabled={update.isPending} status={update.isPending ? "pending" : "idle"}>
          Сохранить
        </Button>
        <Button type="button" variant="outline" onClick={() => void note.refetch()}>
          Обновить с узла
        </Button>
      </div>
    </div>
  );
}

export function PhoneLists({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const lists = useLists(workspaceId);
  const [openId, setOpenId] = useState<string | null>(null);
  if (!workspaceId) return <ModuleOff label="Списки" />;
  const visible = (lists.data ?? []).filter((list) => !list.isTemplate);
  const open = visible.find((list) => list.id === openId);
  if (open) return <ListDetail workspaceId={workspaceId} list={open} onBack={() => setOpenId(null)} />;
  if (lists.isLoading) return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  if (lists.isError) return <BlockError title="Списки не загрузились" onRetry={() => void lists.refetch()} />;
  if (visible.length === 0) return <EmptyState title="Списков нет" description="«/купить молоко» на экране «Сегодня» создаст список покупок." />;
  return (
    <ul className="space-y-1">
      {visible.map((list) => {
        const left = list.items.filter((item) => !item.checked).length;
        return (
          <li key={list.id}>
            <button type="button" className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg px-1 text-left" onClick={() => setOpenId(list.id)}>
              <span>{list.name}</span>
              <span className="text-sm text-muted-foreground">{left}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ListDetail({
  workspaceId,
  list,
  onBack
}: {
  workspaceId: string;
  list: { id: string; name: string; items: { id: string; label: string; checked: boolean }[] };
  onBack: () => void;
}): React.ReactElement {
  const update = useUpdateListItem(workspaceId);
  const { toast } = useToast();
  const items = [...list.items].sort((a, b) => Number(a.checked) - Number(b.checked));
  return (
    <div className="space-y-3">
      <button type="button" className="min-h-[44px] text-sm text-muted-foreground" onClick={onBack}>
        К спискам
      </button>
      <h2 className="text-lg font-semibold">{list.name}</h2>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">Пунктов нет.</p> : null}
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="flex min-h-[44px] items-center gap-2">
            <CheckToggle
              checked={item.checked}
              label={item.checked ? `Снять «${item.label}»` : `Отметить «${item.label}»`}
              onClick={() =>
                update.mutate(
                  { listId: list.id, itemId: item.id, input: { checked: !item.checked } },
                  { onError: (error) => toast({ title: "Не сохранилось", description: describeError(error), tone: "danger" }) }
                )
              }
            />
            <span className={item.checked ? "text-muted-foreground line-through" : undefined}>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

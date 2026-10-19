"use client";

import { useNotes, useTasks } from "@orion/core-react";
import { partitionOpenTasks, type Note, type Task } from "@orion/shared-types";
import { cx } from "@orion/ui";
import { ListTodo, StickyNote } from "lucide-react";
import { useMemo } from "react";
import { relativeTime, shortDateTime } from "../lib/format";
import { openEntity } from "../lib/panel-bus";
import { useEnabledModules } from "../lib/use-enabled-modules";

/**
 * The context column's content for the module that is open (App Sidebar pattern): the rail lists
 * the modules, this column adds what is INSIDE the open one — recent notes next to Notes, what is
 * due next to Tasks — above the projects, which stay where they always are; a short list each, the
 * full one is the panel itself. Read through the public hooks only, and
 * only when the module is on (a switched-off module is never asked for its data).
 */
const rowClass =
  "flex min-h-11 sm:min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-base sm:text-label text-muted-foreground hover:bg-card-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function Heading({ children, count }: { children: string; count?: number }): React.ReactElement {
  return (
    <h2 className="mb-2 flex items-center justify-between px-2 text-micro uppercase text-subtle-foreground">
      <span>{children}</span>
      {count !== undefined ? <span>{count}</span> : null}
    </h2>
  );
}

export function NotesContext({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const { isEnabled } = useEnabledModules();
  const notes = useNotes(isEnabled("notes") ? workspaceId : undefined);
  const recent = useMemo(
    () => [...(notes.data ?? [])].sort((a: Note, b: Note) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6),
    [notes.data]
  );
  return (
    <section aria-label="Недавние заметки">
      <Heading count={notes.data?.length}>Недавние заметки</Heading>
      {notes.isPending ? (
        <p role="status" className="px-2 text-label text-subtle-foreground">Загрузка заметок…</p>
      ) : recent.length === 0 ? (
        <p className="px-2 text-label text-subtle-foreground">Заметок пока нет.</p>
      ) : (
        recent.map((note) => (
          <button key={note.id} type="button" className={rowClass} title={note.title || "Без заголовка"} onClick={() => openEntity("note", note.id, note.title)}>
            <StickyNote className="h-4 w-4 shrink-0 text-subtle-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{note.title || "Без заголовка"}</span>
            <span className="shrink-0 text-2xs text-subtle-foreground">{relativeTime(note.updatedAt)}</span>
          </button>
        ))
      )}
    </section>
  );
}

export function TasksContext({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const { isEnabled } = useEnabledModules();
  const tasks = useTasks(isEnabled("tasks") ? workspaceId : undefined);
  const buckets = useMemo(() => partitionOpenTasks(tasks.data ?? [], new Date()), [tasks.data]);
  const row = (task: Task, late: boolean): React.ReactElement => (
    <button key={task.id} type="button" className={rowClass} title={task.title} onClick={() => openEntity("task", task.id, task.title)}>
      <ListTodo className={cx("h-4 w-4 shrink-0", late ? "text-destructive" : "text-subtle-foreground")} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      {task.dueAt ? <span className={cx("shrink-0 text-2xs", late ? "text-destructive" : "text-subtle-foreground")}>{shortDateTime(task.dueAt)}</span> : null}
    </button>
  );
  if (tasks.isPending) return <p role="status" className="px-2 text-label text-subtle-foreground">Загрузка задач…</p>;
  return (
    <>
      <section aria-label="Просроченные задачи">
        <Heading count={buckets.overdue.length}>Просрочено</Heading>
        {buckets.overdue.length === 0 ? <p className="px-2 text-label text-subtle-foreground">Ничего не просрочено.</p> : buckets.overdue.slice(0, 5).map((task) => row(task, true))}
      </section>
      <section aria-label="Задачи на сегодня">
        <Heading count={buckets.today.length}>Сегодня</Heading>
        {buckets.today.length === 0 ? <p className="px-2 text-label text-subtle-foreground">На сегодня сроков больше нет.</p> : buckets.today.slice(0, 5).map((task) => row(task, false))}
      </section>
    </>
  );
}

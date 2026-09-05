"use client";

import { useCreateTask, useDeleteTask, useTasks, useUpdateTask } from "@orion/core-react";
import { Button, Card, Input, Textarea } from "@orion/ui";
import type { Task, TaskStatus } from "@orion/shared-types";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useActiveWorkspace } from "../../../lib/use-active-workspace";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "К выполнению" },
  { status: "in_progress", label: "В работе" },
  { status: "done", label: "Готово" }
];

/**
 * Converts a UTC ISO string to the local wall-clock value a
 * datetime-local input expects. Slicing the raw ISO string here was the
 * bug: fromDatetimeLocal() interprets its input as local time, so the two
 * were not inverses for any non-UTC timezone — every edit-save round trip
 * silently shifted the due time by the browser's UTC offset.
 */
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function formatDue(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  const overdue = date.getTime() < Date.now();
  const text = date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return overdue ? `⏰ ${text}` : text;
}

export default function TasksPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <TasksBoard />
    </Suspense>
  );
}

function useFocusHighlight(): string | null {
  const params = useSearchParams();
  const focusId = params.get("focus");

  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`task-${focusId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId]);

  return focusId;
}

function TasksBoard(): React.ReactElement {
  const focusId = useFocusHighlight();
  const { workspace } = useActiveWorkspace();
  const { data: tasks, isLoading } = useTasks(workspace?.id);
  const createTask = useCreateTask(workspace?.id);
  const updateTask = useUpdateTask(workspace?.id);
  const deleteTask = useDeleteTask(workspace?.id);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [projectTag, setProjectTag] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDueAt, setEditDueAt] = useState("");
  const [editProjectTag, setEditProjectTag] = useState("");

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim()) return;
    await createTask.mutateAsync({
      title,
      description,
      dueAt: fromDatetimeLocal(dueAt),
      projectTag: projectTag.trim() || null
    });
    setTitle("");
    setDescription("");
    setDueAt("");
    setProjectTag("");
  }

  function moveStatus(task: Task, status: TaskStatus): void {
    updateTask.mutate({ taskId: task.id, input: { status } });
  }

  function startEdit(task: Task): void {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditDescription(task.description);
    setEditDueAt(toDatetimeLocal(task.dueAt));
    setEditProjectTag(task.projectTag ?? "");
  }

  async function saveEdit(taskId: string): Promise<void> {
    await updateTask.mutateAsync({
      taskId,
      input: {
        title: editTitle,
        description: editDescription,
        dueAt: fromDatetimeLocal(editDueAt),
        projectTag: editProjectTag.trim() || null
      }
    });
    setEditingId(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Задачи</h1>

      <Card className="max-w-xl">
        <form className="flex flex-col gap-3" onSubmit={onCreate}>
          <Input placeholder="Заголовок" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <Textarea placeholder="Описание (необязательно)" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex gap-3">
            <Input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="flex-1"
            />
            <Input
              placeholder="Метка проекта (ORION / Stella Mortis / GMap)"
              value={projectTag}
              onChange={(e) => setProjectTag(e.target.value)}
              className="flex-1"
            />
          </div>
          <Button type="submit" disabled={createTask.isPending}>
            {createTask.isPending ? "Добавляем…" : "Добавить задачу"}
          </Button>
        </form>
      </Card>

      {isLoading ? <p className="text-sm text-white/50">Загрузка…</p> : null}

      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((column) => (
          <div key={column.status} className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-white/60">{column.label}</h2>
            {tasks?.filter((t) => t.status === column.status).map((task) => (
              <Card
                key={task.id}
                id={`task-${task.id}`}
                className={`flex flex-col gap-2 transition-colors ${focusId === task.id ? "border-white/60 bg-white/[0.08]" : ""}`}
              >
                {editingId === task.id ? (
                  <div className="flex flex-col gap-2">
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                    <Textarea rows={2} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                    <Input type="datetime-local" value={editDueAt} onChange={(e) => setEditDueAt(e.target.value)} />
                    <Input
                      placeholder="Метка проекта"
                      value={editProjectTag}
                      onChange={(e) => setEditProjectTag(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button onClick={() => saveEdit(task.id)} disabled={updateTask.isPending}>
                        Сохранить
                      </Button>
                      <Button variant="ghost" onClick={() => setEditingId(null)}>
                        Отмена
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{task.title}</span>
                      <div className="flex shrink-0 gap-2 text-xs">
                        <button onClick={() => startEdit(task)} className="text-white/30 hover:text-white">
                          ✎
                        </button>
                        <button onClick={() => deleteTask.mutate(task.id)} className="text-white/30 hover:text-red-300">
                          ✕
                        </button>
                      </div>
                    </div>
                    {task.description ? <p className="text-xs text-white/60">{task.description}</p> : null}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/40">
                      {task.projectTag ? (
                        <span className="rounded-full border border-white/10 px-2 py-0.5">{task.projectTag}</span>
                      ) : null}
                      {task.dueAt ? <span>{formatDue(task.dueAt)}</span> : null}
                    </div>
                    <div className="flex gap-1.5">
                      {COLUMNS.filter((c) => c.status !== task.status).map((c) => (
                        <button
                          key={c.status}
                          onClick={() => moveStatus(task, c.status)}
                          className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/60 hover:bg-white/5 hover:text-white"
                        >
                          → {c.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </Card>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

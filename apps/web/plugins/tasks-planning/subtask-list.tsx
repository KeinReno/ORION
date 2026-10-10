"use client";

import { useCreateTask, useUpdateTask } from "@orion/core-react";
import type { Task } from "@orion/shared-types";
import { isTaskClosed } from "@orion/shared-types";
import { Button, Input, cx, useToast } from "@orion/ui";
import { CornerUpLeft, Plus } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { TASK_STATUS_LABEL } from "../../lib/task-labels";

export function SubtaskList({
  workspaceId,
  parent,
  tasks,
  onOpen
}: {
  workspaceId: string | undefined;
  parent: Task;
  /** Все задачи пространства — дети ищутся по `parentId`. */
  tasks: Task[];
  /** Открыть задачу в том же Sheet (TasksPanel: `setEditingId`). */
  onOpen: (taskId: string) => void;
}): React.ReactElement {
  const createTask = useCreateTask(workspaceId);
  const updateTask = useUpdateTask(workspaceId);
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const parentId = parent.parentId;

  const children = useMemo(
    () =>
      tasks
        .filter((task) => task.parentId === parent.id)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [tasks, parent.id]
  );
  const done = children.filter((child) => isTaskClosed(child.status)).length;

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    await createTask.mutateAsync({
      title: value,
      description: "",
      dueAt: null,
      projectId: parent.projectId,
      priority: "normal",
      recurrence: null,
      dependencyIds: [],
      parentId: parent.id
    });
    setTitle("");
    toast({ title: "Подзадача создана", tone: "success" });
  }

  return (
    <section className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
      <div className="flex items-center gap-2">
        <h3 className="text-label font-medium text-foreground">Подзадачи</h3>
        {children.length > 0 ? (
          <span className="text-micro text-subtle-foreground">
            Сделано {done} из {children.length}
          </span>
        ) : null}
        {parentId ? (
          <Button
            type="button"
            variant="subtle"
            size="sm"
            className="ml-auto h-6 px-2 text-micro"
            onClick={() => onOpen(parentId)}
          >
            <CornerUpLeft className="h-3.5 w-3.5" /> Открыть родителя
          </Button>
        ) : null}
      </div>

      {children.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-3 text-center text-micro text-subtle-foreground">
          Подзадач пока нет — разбейте задачу на шаги.
        </p>
      ) : (
        <ul className="space-y-1">
          {children.map((child) => {
            const closed = isTaskClosed(child.status);
            return (
              <li key={child.id} className="flex items-center gap-2 py-row">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 shrink-0 accent-current"
                  checked={closed}
                  aria-label={closed ? `Вернуть в работу: ${child.title}` : `Отметить выполненной: ${child.title}`}
                  onChange={() =>
                    updateTask.mutate({ taskId: child.id, input: { status: closed ? "todo" : "done" } })
                  }
                />
                <button
                  type="button"
                  onClick={() => onOpen(child.id)}
                  className={cx(
                    "min-w-0 flex-1 truncate text-left text-label text-muted-foreground hover:text-foreground",
                    closed && "line-through"
                  )}
                >
                  {child.title}
                </button>
                {child.status !== "todo" ? (
                  <span className="shrink-0 text-micro text-subtle-foreground">{TASK_STATUS_LABEL[child.status]}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={create} className="flex items-center gap-2">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Новая подзадача"
          aria-label="Новая подзадача"
          className="py-1.5 text-xs"
        />
        <Button type="submit" size="sm" disabled={createTask.isPending || !title.trim()}>
          <Plus className="h-4 w-4" /> Добавить
        </Button>
      </form>
    </section>
  );
}

"use client";

import type { Project, Task } from "@orion/shared-types";
import { Button, Input, Select, Textarea } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { fromDatetimeLocal } from "../../lib/format";

/**
 * Start/end are edited as local wall-clock values (`datetime-local`) and leave
 * this form as ISO instants — the conversion pair lives in `lib/format.ts`, so
 * the form and the rest of the panel can't disagree about the time zone.
 */
export interface EntryFormValues {
  taskId: string | null;
  projectId: string | null;
  note: string;
  startedAt: string;
  endedAt: string;
}

/** Same fields, but with the two times still in `datetime-local` form. */
export interface EntryFormDraft {
  taskId: string;
  projectId: string;
  note: string;
  startedAt: string;
  endedAt: string;
}

/**
 * One form for both manual creation and editing (v0.18): the two payloads
 * differ only in what the caller does with the values, and the server checks
 * "конец позже начала" on the merged record anyway — see `updateTimeEntryInputSchema`.
 */
export function EntryForm({
  tasks,
  projects,
  initial,
  busy,
  submitLabel,
  submitHint,
  onCancel,
  onSubmit
}: {
  tasks?: Task[];
  projects?: Project[];
  initial: EntryFormDraft;
  busy: boolean;
  submitLabel: string;
  submitHint?: string;
  onCancel: () => void;
  onSubmit: (values: EntryFormValues) => void | Promise<void>;
}): React.ReactElement {
  const [taskId, setTaskId] = useState(initial.taskId);
  const [projectId, setProjectId] = useState(initial.projectId);
  const [note, setNote] = useState(initial.note);
  const [startedAt, setStartedAt] = useState(initial.startedAt);
  const [endedAt, setEndedAt] = useState(initial.endedAt);

  const startIso = fromDatetimeLocal(startedAt);
  const endIso = fromDatetimeLocal(endedAt);
  const rangeError =
    startIso && endIso && new Date(endIso).getTime() <= new Date(startIso).getTime()
      ? "Конец должен быть позже начала"
      : null;
  const ready = Boolean(startIso && endIso && !rangeError);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!startIso || !endIso || rangeError) return;
    void onSubmit({
      taskId: taskId || null,
      projectId: projectId || null,
      note: note.trim(),
      startedAt: startIso,
      endedAt: endIso
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {tasks ? (
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Задача
        <Select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
          <option value="">Без задачи</option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </Select>
      </label>
      ) : null}

      {projects ? (
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Проект
        <Select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          <option value="">Без проекта</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      </label>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Начало
          <Input type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Конец
          <Input type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} required />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Заметка
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Над чем работали?"
          rows={2}
          maxLength={2_000}
        />
      </label>

      {rangeError ? <p className="text-2xs text-destructive">{rangeError}</p> : null}
      {submitHint ? <p className="text-2xs text-subtle-foreground">{submitHint}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy || !ready}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

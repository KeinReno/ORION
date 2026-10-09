"use client";

import { ApiError } from "@orion/core";
import { useStartTimer, useStopTimer, useUpdateTimeEntry } from "@orion/core-react";
import { entryMinutes, formatDuration, type Project, type Task, type TimeEntry } from "@orion/shared-types";
import { Button, Card, Input, LiveDot, Select, useToast } from "@orion/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Play, Square } from "lucide-react";
import { useState } from "react";
import { useNowTick } from "./use-now";

/**
 * The start/stop widget at the top of the time panel.
 *
 * While a timer runs, the duration is ticked locally every second from
 * `startedAt` (`useNowTick` + `entryMinutes`) — no request per tick. The server
 * is only asked *whether* something runs (`useRunningTimer`), which is why a
 * 409 here means "another tab got there first": the local cache is wrong, not
 * the user, so the conflict invalidates `["time-running"]` instead of failing.
 *
 * The panel mounts this with `key={running?.id ?? "idle"}`, so every start/stop
 * resets the drafts below.
 */
export function TimerWidget({
  workspaceId,
  running,
  tasks,
  projects
}: {
  workspaceId: string;
  running: TimeEntry | null;
  tasks?: Task[];
  projects?: Project[];
}): React.ReactElement {
  const startTimer = useStartTimer(workspaceId);
  const stopTimer = useStopTimer(workspaceId);
  const updateEntry = useUpdateTimeEntry(workspaceId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const now = useNowTick(running !== null);

  // Drafts of the "nothing is running" form.
  const [taskId, setTaskId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [startNote, setStartNote] = useState("");
  // Draft of the running entry's note; saved on blur / Enter, not per keystroke.
  const [noteDraft, setNoteDraft] = useState(running?.note ?? "");

  function reportConflict(): void {
    void queryClient.invalidateQueries({ queryKey: ["time-running", workspaceId] });
    toast({ title: "Уже идёт", tone: "default" });
  }

  async function handleStart(): Promise<void> {
    try {
      await startTimer.mutateAsync({
        taskId: taskId || null,
        projectId: projectId || null,
        note: startNote.trim()
      });
      setStartNote("");
      toast({ title: "Таймер запущен", tone: "success" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        reportConflict();
        return;
      }
      toast({ title: "Не удалось запустить таймер", tone: "danger" });
    }
  }

  async function handleStop(): Promise<void> {
    try {
      await stopTimer.mutateAsync({});
      toast({ title: "Таймер остановлен", tone: "success" });
    } catch {
      toast({ title: "Не удалось остановить таймер", tone: "danger" });
    }
  }

  async function saveNote(): Promise<void> {
    if (!running || noteDraft === running.note) return;
    try {
      await updateEntry.mutateAsync({ entryId: running.id, input: { note: noteDraft } });
      toast({ title: "Заметка сохранена", tone: "success" });
    } catch {
      setNoteDraft(running.note);
      toast({ title: "Не удалось сохранить заметку", tone: "danger" });
    }
  }

  if (running) {
    const minutes = entryMinutes(running, now);
    // The canonical duration is the `formatDuration(minutes)` below; this is
    // only the remainder of the same difference, so the 1-second tick is
    // visible instead of changing the display once a minute.
    const seconds =
      Math.max(0, Math.floor((now.getTime() - new Date(running.startedAt).getTime()) / 1000)) % 60;
    const task = running.taskId ? (tasks ?? []).find((item) => item.id === running.taskId) : undefined;
    const project = running.projectId ? (projects ?? []).find((item) => item.id === running.projectId) : undefined;

    return (
      <Card className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-accent">
              <LiveDot />
              <span className="font-mono text-display tabular-nums text-foreground">
                {formatDuration(minutes)}
              </span>
              <span className="font-mono text-title tabular-nums text-subtle-foreground">
                :{String(seconds).padStart(2, "0")}
              </span>
            </div>
            <p className="mt-1 truncate text-title text-foreground">{task?.title ?? project?.name ?? "Без задачи"}</p>
            {project && task ? (
              <p className="text-micro text-subtle-foreground">{project.name}</p>
            ) : null}
          </div>
          <Button
            size="sm"
            variant="danger"
            disabled={stopTimer.isPending || updateEntry.isPending}
            onClick={() => void handleStop()}
          >
            <Square className="h-3.5 w-3.5" /> Стоп
          </Button>
        </div>

        <Input
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          onBlur={() => void saveNote()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          placeholder="Заметка к записи"
          aria-label="Заметка к текущей записи"
          maxLength={2_000}
          disabled={updateEntry.isPending}
        />
        <p className="text-2xs text-subtle-foreground">Заметка сохраняется по Enter или когда поле теряет фокус.</p>
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <span className="font-mono text-display tabular-nums text-muted-foreground">0 мин</span>
        <Button size="sm" disabled={startTimer.isPending} onClick={() => void handleStart()}>
          <Play className="h-3.5 w-3.5" /> Старт
        </Button>
      </div>

      {(tasks || projects) ? (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
        {tasks ? (
        <label className="flex flex-col gap-1 text-micro text-subtle-foreground">
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
        <label className="flex flex-col gap-1 text-micro text-subtle-foreground">
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
      </div>
      ) : null}

      <Input
        value={startNote}
        onChange={(event) => setStartNote(event.target.value)}
        placeholder="Над чем работаете?"
        aria-label="Заметка к новой записи"
        maxLength={2_000}
      />

      {tasks && projects ? (
        <p className="text-micro text-subtle-foreground">Если выбрать задачу, проект подтянется из неё.</p>
      ) : null}
    </Card>
  );
}

"use client";

import { ApiError } from "@orion/core";
import type { Milestone, Project, Task, TaskPriority, TaskRecurrence, TaskStatus, WorkspaceMember } from "@orion/shared-types";
import { Button, Input, Select, Textarea } from "@orion/ui";
import { Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { fromDatetimeLocal, relativeTime, toDatetimeLocal } from "../lib/format";
import { describeError } from "../lib/error-message";
import { useSlotContributions } from "../lib/extensions/slot";
import {
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_ORDER,
  TASK_RECURRENCE_LABEL,
  TASK_STATUS_LABEL,
  TASK_STATUS_ORDER
} from "../lib/task-labels";
import { useUnsavedDraft } from "../lib/unsaved-drafts";

/**
 * The task create/edit form — deliberately split out of TasksPanel.tsx
 * (see CLAUDE.md "Про размер файлов": board and task form are the two
 * independent concerns that justify the cut once the panel passes ~400
 * lines). Reused by both the "new task" Modal and the detail Sheet.
 */

export { TASK_PRIORITY_LABEL, TASK_PRIORITY_ORDER, TASK_STATUS_LABEL, TASK_STATUS_ORDER };
export { TASK_RECURRENCE_LABEL };

/** 400 about a parent cycle → human copy; anything else goes through describeError. */
export function describeTaskFormError(error: unknown): string {
  if (error instanceof ApiError && error.status === 400 && /подзадач|родител/i.test(error.message)) {
    return "Нельзя выбрать родителем свою подзадачу";
  }
  return describeError(error);
}

export interface TaskFormValues {
  title: string;
  description: string;
  dueAt: string | null;
  /**
   * A real project (v0.14). `Task.projectTag` is derived from it server-side
   * (`resolveProjectTx`), so the client never has to keep the two in sync.
   */
  projectId: string | null;
  /** Родительская задача (`Task.parentId`) — подзадача, либо null. */
  parentId: string | null;
  priority: TaskPriority;
  status?: TaskStatus;
  recurrence: TaskRecurrence | null;
  dependencyIds: string[];
  /** "Команда" plugin field — absent from the payload (not just null) when the plugin is off, see TasksPanel. */
  assigneeId?: string | null;
  /** Gantt bar's left edge (v0.27) — independent of `dueAt`, the "finish" edge. */
  startAt: string | null;
  /** Planned minutes — "план" side of план/факт (факт — учёт времени). */
  estimatedMinutes: number | null;
  milestoneId: string | null;
}

export function TaskForm({
  initial,
  defaultDueAt,
  defaultProjectId,
  projects,
  members,
  tasks = [],
  milestones,
  parentOptions,
  withStatus = false,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete
}: {
  initial?: Task;
  /** Pre-fill the due field when creating (e.g. the day clicked in the calendar). */
  defaultDueAt?: string | null;
  /** Pre-select a project when creating (the projects panel's "+ Задача"). */
  defaultProjectId?: string | null;
  /** Active projects of this workspace — the "Проект" select. Absent = projects module is off. */
  projects?: Project[];
  /** Workspace members — the "Исполнитель" select. Absent = "Команда" plugin is off. */
  members?: WorkspaceMember[];
  /** Every task of the workspace, for the "зависит от" picker. */
  tasks?: Task[];
  /** Every milestone of the workspace — narrowed to the selected project's own. Absent = no Gantt field shown. */
  milestones?: Milestone[];
  /**
   * Candidate parents for the "Родительская задача" select. The caller already
   * dropped this task and its descendants (see `parentOptions` in
   * panels/tasks/subtasks.tsx) — a cycle would be a 400 from `assertParentTx`.
   */
  parentOptions?: { id: string; title: string }[];
  withStatus?: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: TaskFormValues) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
}): React.ReactElement {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  useUnsavedDraft(title.trim() !== (initial?.title ?? "").trim() || description.trim() !== (initial?.description ?? "").trim());
  const [dueAt, setDueAt] = useState(toDatetimeLocal(initial?.dueAt ?? defaultDueAt ?? null));
  const [projectId, setProjectId] = useState(initial?.projectId ?? defaultProjectId ?? "");
  const [parentId, setParentId] = useState(initial?.parentId ?? "");
  const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? "normal");
  const [status, setStatus] = useState<TaskStatus>(initial?.status ?? "todo");
  const recurrenceApi = useSlotContributions("tasks.recurrence")[0]?.meta?.api;
  const planning = useSlotContributions("tasks.planning")[0]?.meta?.api;
  const [recurrenceFreq, setRecurrenceFreq] = useState<TaskRecurrence["freq"] | "">(initial?.recurrence?.freq ?? "");
  const [recurrenceInterval, setRecurrenceInterval] = useState(String(initial?.recurrence?.interval ?? 1));
  const [dependencyIds, setDependencyIds] = useState<string[]>(initial?.dependencyIds ?? []);
  const [assigneeId, setAssigneeId] = useState(initial?.assigneeId ?? "");
  const [startAt, setStartAt] = useState(toDatetimeLocal(initial?.startAt ?? null));
  const [estimatedHours, setEstimatedHours] = useState(
    initial?.estimatedMinutes !== null && initial?.estimatedMinutes !== undefined ? String(initial.estimatedMinutes / 60) : ""
  );
  const [milestoneId, setMilestoneId] = useState(initial?.milestoneId ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  // A task can't depend on itself, and only tasks of this workspace are offered.
  const dependencyOptions = tasks.filter((task) => task.id !== initial?.id);
  // Only this project's own milestones — a task can't be grouped under another project's phase (see assertMilestoneTx).
  const milestoneOptions = (milestones ?? []).filter((milestone) => milestone.projectId === projectId);
  // A milestone picked before switching projects no longer applies — the select falls back to "no milestone" rather than silently sending a mismatched id.
  const effectiveMilestoneId = milestoneOptions.some((milestone) => milestone.id === milestoneId) ? milestoneId : "";

  // No candidates and no current parent — the field would be an empty select.
  const parentChoices = parentOptions ?? [];
  const showParent = parentOptions !== undefined && (parentChoices.length > 0 || Boolean(parentId));

  function toggleDependency(taskId: string, checked: boolean): void {
    setDependencyIds((current) => (checked ? [...current, taskId] : current.filter((id) => id !== taskId)));
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!title.trim()) return;
    const interval = Number(recurrenceInterval);
    const hours = estimatedHours.trim() ? Number(estimatedHours) : null;
    setFormError(null);
    void (async () => {
      try {
        await onSubmit({
          title: title.trim(),
          description,
          dueAt: fromDatetimeLocal(dueAt),
          projectId: projectId || null,
          parentId: parentId || null,
          priority,
          status: withStatus ? status : undefined,
          recurrence:
            recurrenceFreq === ""
              ? null
              : { freq: recurrenceFreq, interval: Number.isFinite(interval) && interval >= 1 ? Math.min(interval, 365) : 1 },
          dependencyIds,
          startAt: fromDatetimeLocal(startAt),
          estimatedMinutes: hours !== null && Number.isFinite(hours) ? Math.round(hours * 60) : null,
          milestoneId: effectiveMilestoneId || null,
          ...(members ? { assigneeId: assigneeId || null } : {})
        });
      } catch (error) {
        setFormError(describeTaskFormError(error));
      }
    })();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input placeholder="Заголовок" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      <Textarea
        placeholder="Описание (необязательно)"
        rows={4}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {planning ? <planning.StartAt variant="form" value={startAt} onChange={setStartAt} /> : null}
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Срок
          <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </label>
        {planning ? <planning.EstimatedHours variant="form" value={estimatedHours} onChange={setEstimatedHours} /> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Приоритет
          <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {TASK_PRIORITY_ORDER.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
        </label>
        {projects ? (
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Проект
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Без проекта</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </label>
        ) : null}
        {members ? (
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Исполнитель
          <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Не назначен</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        </label>
        ) : null}
      </div>
      {milestoneOptions.length > 0 ? (
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Веха
          <Select value={effectiveMilestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
            <option value="">Без вехи</option>
            {milestoneOptions.map((milestone) => (
              <option key={milestone.id} value={milestone.id}>
                {milestone.title}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        {recurrenceApi ? (
          <recurrenceApi.Fields
            variant="form"
            freq={recurrenceFreq}
            interval={recurrenceInterval}
            onFreqChange={setRecurrenceFreq}
            onIntervalChange={setRecurrenceInterval}
          />
        ) : null}
        {withStatus ? (
          <label className="flex flex-col gap-1 text-label text-subtle-foreground">
            Статус
            <Select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {TASK_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </div>
      {planning && showParent ? <planning.Parent variant="form" value={parentId} options={parentChoices} onChange={setParentId} /> : null}
      {planning && dependencyOptions.length > 0 ? (
        <planning.Dependencies variant="form" selected={dependencyIds} options={dependencyOptions} onToggle={toggleDependency} />
      ) : null}
      {initial ? (
        <p className="text-micro text-subtle-foreground">
          Создано {relativeTime(initial.createdAt)} · изменено {relativeTime(initial.updatedAt)}
          {initial.completedAt ? ` · завершено ${relativeTime(initial.completedAt)}` : ""}
        </p>
      ) : null}
      {formError ? <p className="text-label text-destructive">{formError}</p> : null}
      <div className="mt-1 flex items-center justify-between gap-2">
        {onDelete ? (
          <Button type="button" variant="danger" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4" /> Удалить
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
            Отмена
          </Button>
          <Button type="submit" size="sm" disabled={busy || !title.trim()} title={!title.trim() ? "Введите заголовок" : undefined}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

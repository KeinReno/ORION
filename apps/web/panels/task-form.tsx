"use client";

import { ApiError } from "@orion/core";
import type { Milestone, Project, Task, TaskChecklistItem, TaskPriority, TaskRecurrence, TaskStatus, WorkspaceMember } from "@orion/shared-types";
import { Alert, Button, Combobox, Field, GlideSelect, Input, Textarea } from "@orion/ui";
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
import { draftStorageKey, usePersistedDraft, writeDraft } from "../lib/draft-storage";
import { TaskChecklist } from "./tasks/task-checklist";

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
  checklist: TaskChecklistItem[];
}

export function TaskForm({
  initial,
  defaultDueAt,
  defaultProjectId,
  projects,
  members,
  defaultAssigneeId,
  tasks = [],
  milestones,
  parentOptions,
  withStatus = false,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete,
  draftWorkspaceId,
  draftUserId
}: {
  draftWorkspaceId?: string;
  draftUserId?: string;
  initial?: Task;
  /** Pre-fill the due field when creating (e.g. the day clicked in the calendar). */
  defaultDueAt?: string | null;
  /** Pre-select a project when creating (the projects panel's "+ Задача"). */
  defaultProjectId?: string | null;
  /** Active projects of this workspace — the "Проект" select. Absent = projects module is off. */
  projects?: Project[];
  /** Workspace members — the "Исполнитель" select. Absent = "Команда" plugin is off. */
  members?: WorkspaceMember[];
  /** Pre-select the assignee when creating — the caller's own member id in a team workspace. */
  defaultAssigneeId?: string | null;
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
  const [localTitle, setLocalTitle] = useState(initial?.title ?? "");
  const [localDescription, setLocalDescription] = useState(initial?.description ?? "");
  const persistDraft = !initial && Boolean(draftWorkspaceId && draftUserId);
  const titleDraftName = `new-task-title:${draftUserId}`;
  const descriptionDraftName = `new-task-description:${draftUserId}`;
  const [draftTitle, setDraftTitle] = usePersistedDraft(persistDraft ? draftWorkspaceId : undefined, titleDraftName);
  const [draftDescription, setDraftDescription] = usePersistedDraft(persistDraft ? draftWorkspaceId : undefined, descriptionDraftName);
  const [title, setTitle] = persistDraft ? [draftTitle, setDraftTitle] : [localTitle, setLocalTitle];
  const [description, setDescription] = persistDraft ? [draftDescription, setDraftDescription] : [localDescription, setLocalDescription];
  const [checklist, setChecklist] = useState<TaskChecklistItem[]>(initial?.checklist ?? []);
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
  const [assigneeId, setAssigneeId] = useState(initial ? (initial.assigneeId ?? "") : (defaultAssigneeId ?? ""));
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
          checklist: checklist.filter((item) => item.title.trim()).map((item) => ({ ...item, title: item.title.trim() })),
          ...(members ? { assigneeId: assigneeId || null } : {})
        });
        if (persistDraft && draftWorkspaceId) {
          writeDraft(window.localStorage, draftStorageKey(draftWorkspaceId, titleDraftName), "");
          writeDraft(window.localStorage, draftStorageKey(draftWorkspaceId, descriptionDraftName), "");
        }
      } catch (error) {
        setFormError(describeTaskFormError(error));
      }
    })();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Заголовок">
        <Input placeholder="Заголовок" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      </Field>
      <Textarea
        placeholder="Описание (необязательно)"
        rows={4}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <TaskChecklist items={checklist} onChange={setChecklist} />
      <div className="grid gap-3 sm:grid-cols-3">
        {planning ? <planning.StartAt variant="form" value={startAt} onChange={setStartAt} /> : null}
        <Field label="Срок">
          <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </Field>
        {planning ? <planning.EstimatedHours variant="form" value={estimatedHours} onChange={setEstimatedHours} /> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Приоритет">
          <GlideSelect
            label="Приоритет"
            options={TASK_PRIORITY_ORDER.map((item) => TASK_PRIORITY_LABEL[item])}
            value={TASK_PRIORITY_LABEL[priority]}
            onChange={(label) => {
              const next = TASK_PRIORITY_ORDER.find((item) => TASK_PRIORITY_LABEL[item] === label);
              if (next) setPriority(next);
            }}
          />
        </Field>
        {projects ? (
          <Field label="Проект">
            <Combobox
              label="Проект"
              items={[{ id: "", label: "Без проекта" }, ...projects.map((project) => ({ id: project.id, label: project.name }))]}
              value={projectId}
              onChange={setProjectId}
            />
          </Field>
        ) : null}
        {members ? (
          <Field label="Исполнитель">
            <Combobox
              label="Исполнитель"
              items={[{ id: "", label: "Не назначен" }, ...members.map((member) => ({ id: member.id, label: member.name }))]}
              value={assigneeId}
              onChange={setAssigneeId}
            />
          </Field>
        ) : null}
      </div>
      {milestoneOptions.length > 0 ? (
        <Field label="Веха">
          <Combobox
            label="Веха"
            items={[{ id: "", label: "Без вехи" }, ...milestoneOptions.map((milestone) => ({ id: milestone.id, label: milestone.title }))]}
            value={effectiveMilestoneId}
            onChange={setMilestoneId}
          />
        </Field>
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
          <Field label="Статус">
            <GlideSelect
              label="Статус"
              options={TASK_STATUS_ORDER.map((item) => TASK_STATUS_LABEL[item])}
              value={TASK_STATUS_LABEL[status]}
              onChange={(label) => {
                const next = TASK_STATUS_ORDER.find((item) => TASK_STATUS_LABEL[item] === label);
                if (next) setStatus(next);
              }}
            />
          </Field>
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
      {formError ? <Alert tone="danger" title={formError} /> : null}
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

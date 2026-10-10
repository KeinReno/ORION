"use client";

import { ApiError } from "@orion/core";
import { taskConflictSchema } from "@orion/shared-types";
import {
  useRunningTimer,
  useStartTimer,
  useStopTimer,
  useTaskActivity
} from "@orion/core-react";
import type {
  Milestone,
  Project,
  Task,
  TaskActivity,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
  WorkspaceMember
} from "@orion/shared-types";
import {
  AutosaveStatus,
  Button,
  DropdownMenu,
  IconButton,
  Input,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  cx,
  useToast
} from "@orion/ui";
import { ArrowLeft, MoreHorizontal, Play, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EntityLinksSection } from "../../components/entity-links";
import { describeError } from "../../lib/error-message";
import { relativeTime } from "../../lib/format";
import {
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_ORDER,
  TASK_STATUS_LABEL,
  TASK_STATUS_ORDER,
  describeTaskFormError
} from "../task-form";
import { useSlotContributions } from "../../lib/extensions/slot";
import { SubtaskList } from "./subtasks";
import { buildPatch, fieldsFromTask, sameFields, type Fields } from "../../lib/task-fields";

/** "history" and "links" are the module's own; every other id is a tab a plugin adds via `tasks.detail.tabs`. */
type DetailTab = string;
type SaveState = "saved" | "dirty" | "saving" | "error";

const AUTOSAVE_DELAY_MS = 800;

const ACTIVITY_FIELD_LABEL: Record<string, string> = {
  status: "Статус",
  assigneeId: "Исполнитель",
  dueAt: "Срок"
};

function activityValue(item: TaskActivity, value: string | null): string {
  if (value === null || value === "") return "—";
  if (item.field === "status") return TASK_STATUS_LABEL[value as TaskStatus] ?? value;
  if (item.field === "dueAt") return new Date(value).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return value;
}

/**
 * Task details as a persistent pane next to the board/list (not an overlay):
 * pick another card and the pane follows, nothing has to be closed first.
 * Everything is autosaved — there is no Save/Cancel — and the page order follows
 * how often a field is touched: state and deadline on top, the description, the
 * checklist, then the conversation; rarely-touched planning fields are folded.
 */
export function TaskDetail({
  task,
  workspaceId,
  projects,
  members,
  tasks,
  milestones,
  parentOptions,
  timeOn,
  compact,
  onSave,
  onClose,
  onDelete,
  onOpenTask
}: {
  task: Task;
  workspaceId: string | undefined;
  projects?: Project[];
  members?: WorkspaceMember[];
  tasks: Task[];
  milestones?: Milestone[];
  parentOptions?: { id: string; title: string }[];
  /** The time module is on — show the start/stop timer. */
  timeOn: boolean;
  /** Narrow panel: the pane replaces the list, so "close" reads as "back". */
  compact: boolean;
  /** Resolves with the saved task (its new revision is the base of the next edit). */
  onSave: (taskId: string, patch: UpdateTaskInput) => Promise<Task | void>;
  onClose: () => void;
  onDelete: () => void;
  onOpenTask: (taskId: string) => void;
}): React.ReactElement {
  const [fields, setFields] = useState<Fields>(() => fieldsFromTask(task));
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  // Another editor saved this task first: autosave stops until you choose which version to keep.
  const [conflict, setConflict] = useState<Task | null>(null);
  const conflictRef = useRef<Task | null>(null);
  conflictRef.current = conflict;
  // The revision the next save is based on: what this pane last loaded or saved.
  const revisionRef = useRef(task.revision);
  const [tab, setTab] = useState<DetailTab | null>(null);
  const recurrenceApi = useSlotContributions("tasks.recurrence")[0]?.meta?.api;
  const pluginTabs = useSlotContributions("tasks.detail.tabs").filter((c) => c.meta !== undefined);
  const tabOptions: { value: DetailTab; label: string }[] = [
    ...pluginTabs.filter((c) => c.meta?.before).map((c) => ({ value: c.meta!.tabId, label: c.meta!.label })),
    { value: "history", label: "История" },
    { value: "links", label: "Связи" },
    ...pluginTabs.filter((c) => !c.meta?.before).map((c) => ({ value: c.meta!.tabId, label: c.meta!.label }))
  ];
  // First tab by default (comments, when that plugin is on); a chosen tab whose plugin was switched off falls back to it.
  const activeTab = tabOptions.some((option) => option.value === tab) ? tab! : tabOptions[0]!.value;
  const activePluginTab = pluginTabs.find((c) => c.meta?.tabId === activeTab);

  const withAssignee = members !== undefined;
  const baseline = useRef<Fields>(fields);
  const fieldsRef = useRef<Fields>(fields);
  fieldsRef.current = fields;
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const taskId = task.id;

  async function flush(): Promise<void> {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) return; // the running save re-checks for newer edits when it ends
    if (conflictRef.current) return; // waiting for the user to resolve a conflict
    const sent = fieldsRef.current;
    const patch = buildPatch(baseline.current, sent, withAssignee);
    if (Object.keys(patch).length === 0) {
      setSaveState("saved");
      return;
    }
    inFlight.current = true;
    setSaveState("saving");
    setSaveError(null);
    try {
      const saved = await onSaveRef.current(taskId, { ...patch, expectedRevision: revisionRef.current });
      baseline.current = sent;
      if (saved) revisionRef.current = saved.revision;
    } catch (error) {
      inFlight.current = false;
      const parsed = error instanceof ApiError && error.status === 409 ? taskConflictSchema.safeParse(error.details) : null;
      if (parsed?.success) {
        setConflict(parsed.data.current);
        setSaveState("dirty");
        return;
      }
      setSaveError(describeTaskFormError(error));
      setSaveState("error");
      return;
    }
    inFlight.current = false;
    if (Object.keys(buildPatch(baseline.current, fieldsRef.current, withAssignee)).length > 0) {
      void flush();
    } else {
      setSaveState("saved");
    }
  }
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Edits → debounce → save. A failed save stays "error" until the user edits again or retries.
  useEffect(() => {
    if (Object.keys(buildPatch(baseline.current, fields, withAssignee)).length === 0) return;
    setSaveState((state) => (state === "saving" ? state : "dirty"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), AUTOSAVE_DELAY_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  // The task changed elsewhere (board drag, another tab): adopt it, unless this pane has unsaved edits.
  useEffect(() => {
    if (inFlight.current) return;
    if (Object.keys(buildPatch(baseline.current, fieldsRef.current, withAssignee)).length > 0) return;
    revisionRef.current = task.revision;
    const fresh = fieldsFromTask(task);
    if (sameFields(fresh, fieldsRef.current)) return;
    baseline.current = fresh;
    setFields(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  // Switching to another task unmounts this pane (the parent keys it by id): save what is pending first.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void flushRef.current();
    },
    []
  );

  /** Conflict: take the server's copy (drops this pane's unsaved edits). */
  function loadServerVersion(): void {
    const latest = conflict;
    if (!latest) return;
    const fresh = fieldsFromTask(latest);
    baseline.current = fresh;
    revisionRef.current = latest.revision;
    setConflict(null);
    setFields(fresh);
    setSaveState("saved");
  }

  /** Conflict: keep my edits and write them over the server's copy. */
  function keepMine(): void {
    const latest = conflict;
    if (!latest) return;
    revisionRef.current = latest.revision;
    conflictRef.current = null;
    setConflict(null);
    void flushRef.current();
  }

  function set<K extends keyof Fields>(key: K, value: Fields[K]): void {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function setProject(projectId: string): void {
    setFields((current) => {
      const stillValid = (milestones ?? []).some((m) => m.id === current.milestoneId && m.projectId === projectId);
      return { ...current, projectId, milestoneId: stillValid ? current.milestoneId : "" };
    });
  }

  const milestoneOptions = (milestones ?? []).filter((m) => m.projectId === fields.projectId);
  const dependencyOptions = tasks.filter((t) => t.id !== task.id);
  const showParent = parentOptions !== undefined && ((parentOptions?.length ?? 0) > 0 || Boolean(fields.parentId));

  const menuItems: React.ComponentProps<typeof DropdownMenu>["items"] = [
    { label: "Удалить задачу", icon: Trash2, tone: "danger", onSelect: onDelete }
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        {compact ? (
          <Button size="sm" variant="ghost" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" /> Задачи
          </Button>
        ) : null}
        <Select
          aria-label="Статус"
          value={fields.status}
          onChange={(event) => set("status", event.target.value as TaskStatus)}
          className="w-auto !min-w-[10.5rem]"
        >
          {TASK_STATUS_ORDER.map((status) => (
            <option key={status} value={status}>
              {TASK_STATUS_LABEL[status]}
            </option>
          ))}
        </Select>
        {timeOn ? <TaskTimer workspaceId={workspaceId} task={task} /> : null}
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu
            align="end"
            trigger={({ toggle }) => (
              <IconButton label="Действия" size="sm" onClick={toggle}>
                <MoreHorizontal className="h-4 w-4" />
              </IconButton>
            )}
            items={menuItems}
          />
          {compact ? null : (
            <IconButton label="Закрыть" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      </header>

      <div className="orion-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {conflict ? (
          <div role="alert" className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-label text-foreground">
            <p>Эту задачу изменил кто-то другой, пока вы редактировали. Что оставить?</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="subtle" onClick={loadServerVersion}>
                Загрузить версию сервера
              </Button>
              <Button size="sm" variant="outline" onClick={keepMine}>
                Сохранить мою поверх
              </Button>
            </div>
          </div>
        ) : null}

        {saveState === "error" && saveError ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-label text-foreground">
            <span>{saveError}</span>
            <Button size="sm" variant="subtle" onClick={() => void flush()}>
              Повторить
            </Button>
          </div>
        ) : null}

        {/* The save state sits above the title, not in the cramped header, so it never wraps. */}
        <div className="-mb-2 flex min-h-4 justify-end">
          <AutosaveStatus state={saveState} className="whitespace-nowrap" />
        </div>

        <input
          value={fields.title}
          onChange={(event) => set("title", event.target.value)}
          aria-label="Название задачи"
          placeholder="Название"
          className="w-full bg-transparent text-title text-foreground outline-none placeholder:text-subtle-foreground"
        />

        <div className="grid grid-cols-2 gap-3">
          <Prop label="Срок">
            <Input type="datetime-local" value={fields.dueAt} onChange={(event) => set("dueAt", event.target.value)} />
          </Prop>
          <Prop label="Приоритет">
            <Select value={fields.priority} onChange={(event) => set("priority", event.target.value as TaskPriority)}>
              {TASK_PRIORITY_ORDER.map((priority) => (
                <option key={priority} value={priority}>
                  {TASK_PRIORITY_LABEL[priority]}
                </option>
              ))}
            </Select>
          </Prop>
          {members ? (
            <Prop label="Исполнитель">
              <Select value={fields.assigneeId} onChange={(event) => set("assigneeId", event.target.value)}>
                <option value="">Не назначен</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </Prop>
          ) : null}
          {projects ? (
            <Prop label="Проект" wide>
              <Select value={fields.projectId} onChange={(event) => setProject(event.target.value)}>
                <option value="">Без проекта</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </Prop>
          ) : null}
        </div>

        <Textarea
          aria-label="Описание"
          placeholder="Описание — зачем это и что считать готовым"
          rows={5}
          value={fields.description}
          onChange={(event) => set("description", event.target.value)}
        />

        <SubtaskList workspaceId={workspaceId} parent={task} tasks={tasks} onOpen={onOpenTask} />

        <details className="rounded-lg border border-border bg-white/[0.02] px-3 py-2">
          <summary className="cursor-pointer text-label text-muted-foreground">Планирование и повтор</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Prop label="Начало (план)">
              <Input type="datetime-local" value={fields.startAt} onChange={(event) => set("startAt", event.target.value)} />
            </Prop>
            <Prop label="План, часы">
              <Input
                inputMode="decimal"
                placeholder="Не оценено"
                value={fields.estimatedHours}
                onChange={(event) => set("estimatedHours", event.target.value)}
              />
            </Prop>
            {recurrenceApi ? (
              <recurrenceApi.Fields
                variant="detail"
                freq={fields.recurrenceFreq}
                interval={fields.recurrenceInterval}
                onFreqChange={(freq) => set("recurrenceFreq", freq)}
                onIntervalChange={(interval) => set("recurrenceInterval", interval)}
              />
            ) : null}
            {milestoneOptions.length > 0 ? (
              <Prop label="Веха">
                <Select value={fields.milestoneId} onChange={(event) => set("milestoneId", event.target.value)}>
                  <option value="">Без вехи</option>
                  {milestoneOptions.map((milestone) => (
                    <option key={milestone.id} value={milestone.id}>
                      {milestone.title}
                    </option>
                  ))}
                </Select>
              </Prop>
            ) : null}
            {showParent ? (
              <Prop label="Родительская задача">
                <Select value={fields.parentId} onChange={(event) => set("parentId", event.target.value)}>
                  <option value="">Нет</option>
                  {(parentOptions ?? []).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.title}
                    </option>
                  ))}
                </Select>
              </Prop>
            ) : null}
          </div>
          {dependencyOptions.length > 0 ? (
            <div className="mt-3">
              <p className="text-label text-subtle-foreground">
                Зависит от{fields.dependencyIds.length > 0 ? ` · ${fields.dependencyIds.length}` : ""}
              </p>
              <div className="orion-scroll mt-1 max-h-40 space-y-1 overflow-y-auto pr-1">
                {dependencyOptions.map((other) => (
                  <label key={other.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-current"
                      checked={fields.dependencyIds.includes(other.id)}
                      onChange={(event) =>
                        set(
                          "dependencyIds",
                          (event.target.checked
                            ? [...fields.dependencyIds, other.id]
                            : fields.dependencyIds.filter((id) => id !== other.id)
                          ).sort()
                        )
                      }
                    />
                    <span className="truncate">{other.title}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-micro text-subtle-foreground">
                Пока зависимость не закрыта, задача помечается как заблокированная.
              </p>
            </div>
          ) : null}
        </details>

        <section className="space-y-3">
          <SegmentedControl<DetailTab> value={activeTab} onChange={setTab} size="sm" options={tabOptions} />
          {activePluginTab ? <activePluginTab.component workspaceId={workspaceId} taskId={task.id} /> : null}
          {activeTab === "history" ? <TaskHistory workspaceId={workspaceId} taskId={task.id} /> : null}
          {activeTab === "links" ? <EntityLinksSection workspaceId={workspaceId} type="task" id={task.id} /> : null}
        </section>

        <p className="text-micro text-subtle-foreground">
          Создано {relativeTime(task.createdAt)} · изменено {relativeTime(task.updatedAt)}
          {task.completedAt ? ` · завершено ${relativeTime(task.completedAt)}` : ""}
        </p>
      </div>
    </div>
  );
}

function Prop({
  label,
  wide,
  children
}: {
  label: string;
  /** Takes the whole row of the two-column grid — for values that read long (a project name). */
  wide?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1 text-label text-subtle-foreground", wide && "col-span-2")}>
      {label}
      {children}
    </label>
  );
}

/** Start/stop the user's single running timer on this task (UI «Время»: вход — из задачи). */
function TaskTimer({ workspaceId, task }: { workspaceId: string | undefined; task: Task }): React.ReactElement {
  const { toast } = useToast();
  const { data: running } = useRunningTimer(workspaceId);
  const start = useStartTimer(workspaceId);
  const stop = useStopTimer(workspaceId);
  const onThisTask = running?.taskId === task.id;
  const elsewhere = Boolean(running) && !onThisTask;

  function toggle(): void {
    const options = { onError: (error: Error) => toast({ title: "Таймер", description: describeError(error), tone: "danger" as const }) };
    if (onThisTask) stop.mutate({}, options);
    else start.mutate({ taskId: task.id, projectId: task.projectId, note: "" }, options);
  }

  return (
    <Button
      size="sm"
      variant={onThisTask ? "primary" : "outline"}
      onClick={toggle}
      disabled={elsewhere || start.isPending || stop.isPending}
      title={elsewhere ? "Уже идёт таймер на другой записи — остановите его во «Времени»" : undefined}
    >
      {onThisTask ? (
        <>
          <Square className="h-3.5 w-3.5" /> Стоп
        </>
      ) : (
        <>
          <Play className="h-3.5 w-3.5" /> Старт
        </>
      )}
    </Button>
  );
}

function TaskHistory({ workspaceId, taskId }: { workspaceId: string | undefined; taskId: string }): React.ReactElement {
  const { data, isLoading } = useTaskActivity(workspaceId, taskId);
  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!data || data.length === 0) {
    return <p className="text-label text-subtle-foreground">Изменений статуса, срока и исполнителя пока не было.</p>;
  }
  return (
    <ul className="space-y-2">
      {[...data]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((item) => (
          <li key={item.id} className="text-label text-muted-foreground">
            <span className="text-foreground">{ACTIVITY_FIELD_LABEL[item.field] ?? item.field}:</span>{" "}
            {item.field === "assigneeId" ? "изменён" : `${activityValue(item, item.fromValue)} → ${activityValue(item, item.toValue)}`}
            <span className="block text-micro text-subtle-foreground">
              {item.actorName ?? "Система"} · {relativeTime(item.createdAt)}
            </span>
          </li>
        ))}
    </ul>
  );
}

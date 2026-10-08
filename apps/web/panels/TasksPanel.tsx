"use client";

import { useCreateTask, useDeleteTask, useMilestones, useProjects, useTasks, useUpdateTask, useWorkspaceMembers } from "@orion/core-react";
import type { CreateTaskInput, Task, TaskPriority, TaskStatus } from "@orion/shared-types";
import { isTaskClosed } from "@orion/shared-types";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  PanelHeader,
  PanelShell,
  SegmentedControl,
  Sheet,
  Skeleton,
  cx,
  isTypingTarget,
  usePanelVisible,
  useToast
} from "@orion/ui";
import { motion, useReducedMotion } from "framer-motion";
import { ListTodo, Plus, Search, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nextListId } from "../lib/list-nav";
import { DUE_BUCKET_LABEL, dueBucket, type DueBucket } from "../lib/format";
import { describeError } from "../lib/error-message";
import { FilterChip } from "../components/filter-chip";
import { EntityLinksSection } from "../components/entity-links";
import { useFocusedTaskId, useTasksProjectSignal } from "../lib/panel-bus";
import {
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_ORDER,
  TASK_STATUS_LABEL,
  TASK_STATUS_ORDER,
  TaskForm,
  type TaskFormValues
} from "./task-form";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { useEnabledPlugins } from "../lib/use-enabled-plugins";
import { TaskCard, type TaskAssignee } from "./tasks/task-card";
import { SavedViewsBar } from "./tasks/saved-views";
import {
  SubtaskList,
  canMoveNeighbor,
  orderColumnTasks,
  parentOptions,
  subtaskProgressMap,
  useTaskReorder
} from "./tasks/subtasks";
import { TaskCommentsSection } from "./tasks/task-comments";

type GroupBy = "status" | "project" | "due" | "priority";
type BoardView = "board" | "list";

const NO_PROJECT = "__none__";
const VIEW_KEY = "orion.tasks.view";

function loadView(fallback: BoardView): BoardView {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw === "board" || raw === "list") return raw;
  } catch {
    /* ignore */
  }
  return fallback;
}
const STATUS_DOT: Record<TaskStatus, string> = {
  backlog: "bg-subtle-foreground/50",
  todo: "bg-subtle-foreground",
  in_progress: "bg-warning",
  done: "bg-success",
  canceled: "bg-destructive/60"
};
const PRIORITY_COLUMN_DOT: Record<TaskPriority, string> = {
  high: "bg-destructive",
  normal: "bg-accent",
  low: "bg-subtle-foreground/50"
};
const DUE_ORDER: DueBucket[] = ["overdue", "today", "tomorrow", "week", "later", "none"];
const DONE_COLLAPSE = 5;

/** Collapsed «Готово»: last N by completedAt desc (freshly closed first). */
function lastCompleted(tasks: Task[], limit: number): Task[] {
  return [...tasks]
    .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))
    .slice(0, limit);
}

interface Column {
  key: string;
  label: string;
  dot?: string;
  tasks: Task[];
  droppable: boolean;
}

export function TasksPanel(): React.ReactElement {
  const reduceMotion = useReducedMotion();
  const panelVisible = usePanelVisible();
  const { workspace } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  const { isEnabled: isPluginEnabled } = useEnabledPlugins();
  const teamOn = isPluginEnabled("team");
  // 06-MODULES.md: «Личный default — список; командный — «Мои задачи», рядом
  // Все» — a team workspace defaults to the mine-scoped view (not a full
  // roster board), a personal one has no team distinction to make. Once the
  // user has explicitly toggled it, that choice is remembered per-browser
  // and stops tracking the default.
  const [onlyMine, setOnlyMine] = useState(teamOn);
  const onlyMineTouched = useRef(false);
  useEffect(() => {
    if (onlyMineTouched.current) return;
    setOnlyMine(teamOn);
  }, [teamOn]);
  const { data: tasks, isLoading, isError, error, refetch } = useTasks(workspace?.id, undefined, teamOn && onlyMine);
  // Board (columns, drag-and-drop) vs list (single stacked column, same
  // cards/groups) — 06-MODULES/10-BACKLOG S13 require both to be reachable,
  // not just the board. Default follows scope like `onlyMine` above; the
  // user's explicit pick is remembered the same way inbox remembers groupBy.
  const [view, setView] = useState<BoardView>(() => loadView(teamOn ? "board" : "list"));
  const viewTouched = useRef(false);
  useEffect(() => {
    if (viewTouched.current) return;
    setView(loadView(teamOn ? "board" : "list"));
  }, [teamOn]);
  useEffect(() => {
    if (!viewTouched.current) return;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* ignore */
    }
  }, [view]);
  const { data: projectList } = useProjects(isEnabled("projects") ? workspace?.id : undefined);
  const { data: milestoneList } = useMilestones(isEnabled("projects") ? workspace?.id : undefined);
  const { data: memberList } = useWorkspaceMembers(teamOn ? workspace?.id : undefined);
  const createTask = useCreateTask(workspace?.id);
  const updateTask = useUpdateTask(workspace?.id);
  const deleteTask = useDeleteTask(workspace?.id);
  const { toast } = useToast();

  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);

  // Перетаскивание/«Вверх»/«Вниз» — ручной порядок (`sortOrder`), детали в
  // panels/tasks/subtasks.tsx, чтобы доска осталась про раскладку.
  const { dragOverKey, setDragOverKey, dropOnTask, moveToNeighbor } = useTaskReorder(tasks, updateTask.mutate);

  const focusedTaskId = useFocusedTaskId();
  useEffect(() => {
    if (focusedTaskId) {
      setEditingId(focusedTaskId);
      setSelectedId(focusedTaskId);
    }
  }, [focusedTaskId]);

  const projectSignal = useTasksProjectSignal();
  useEffect(() => {
    if (!projectSignal) return;
    setProjectFilter(projectSignal.projectId);
  }, [projectSignal]);

  const projectTags = useMemo(() => {
    const set = new Set<string>();
    for (const task of tasks ?? []) if (task.projectTag) set.add(task.projectTag);
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [tasks]);

  const projectChips = useMemo(() => {
    const byId = new Map((projectList ?? []).map((project) => [project.id, project]));
    const ids = new Set<string>();
    for (const task of tasks ?? []) if (task.projectId) ids.add(task.projectId);
    if (projectFilter) ids.add(projectFilter);
    return [...ids]
      .map((id) => byId.get(id) ?? { id, name: (tasks ?? []).find((task) => task.projectId === id)?.projectTag ?? "Проект" })
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [projectList, tasks, projectFilter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (tasks ?? []).filter((task) => {
      if (projectFilter && (task.projectId ?? NO_PROJECT) !== projectFilter) return false;
      if (q && !task.title.toLowerCase().includes(q) && !task.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, query, projectFilter]);

  const editing = editingId ? (tasks ?? []).find((t) => t.id === editingId) ?? null : null;
  // Варианты для селекта «Родительская задача»: без самой задачи и её потомков —
  // такой выбор бэкенд отклонит 400-й за цикл (`assertParentTx` в tasks.service).
  const parentSelectOptions = useMemo(
    () => parentOptions(tasks ?? [], creating ? undefined : editing?.id),
    [tasks, creating, editing?.id]
  );
  const childProgress = useMemo(() => subtaskProgressMap(tasks ?? []), [tasks]);
  const memberById = useMemo(() => new Map((memberList ?? []).map((m) => [m.id, m])), [memberList]);
  function assigneeOf(task: Task): TaskAssignee | undefined {
    const m = task.assigneeId ? memberById.get(task.assigneeId) : undefined;
    return m ? { userId: m.userId, name: m.name, hasAvatar: m.hasAvatar } : undefined;
  }

  const columns: Column[] = useMemo(() => {
    // Подзадачи идут сразу под своим родителем; `sortOrder` (ручной порядок)
    // задаёт базу только в колонках статусов — в остальных группировках
    // исходный порядок задач сохраняется.
    const ordered = (list: Task[]): Task[] =>
      orderColumnTasks(list, groupBy === "status");
    if (groupBy === "status") {
      return TASK_STATUS_ORDER.map((status) => ({
        key: status,
        label: TASK_STATUS_LABEL[status],
        dot: STATUS_DOT[status],
        droppable: true,
        tasks: ordered(filtered.filter((t) => t.status === status))
      }));
    }
    if (groupBy === "project") {
      return [...projectTags, NO_PROJECT].map((key) => ({
        key,
        label: key === NO_PROJECT ? "Без проекта" : key,
        droppable: true,
        tasks: ordered(filtered.filter((t) => (t.projectTag ?? NO_PROJECT) === key))
      }));
    }
    if (groupBy === "priority") {
      return TASK_PRIORITY_ORDER.map((priority) => ({
        key: priority,
        label: TASK_PRIORITY_LABEL[priority],
        dot: PRIORITY_COLUMN_DOT[priority],
        droppable: true,
        tasks: ordered(filtered.filter((t) => t.priority === priority))
      }));
    }
    return DUE_ORDER.map((bucket) => ({
      key: bucket,
      label: DUE_BUCKET_LABEL[bucket],
      droppable: false,
      tasks: ordered(filtered.filter((t) => dueBucket(t.dueAt, t.status === "done") === bucket))
    })).filter((col) => col.tasks.length > 0);
  }, [groupBy, filtered, projectTags]);

  const visibleTaskIds = useMemo(
    () =>
      columns.flatMap((column) => {
        const collapsible = groupBy === "status" && column.key === "done" && !showAllDone;
        const shown = collapsible ? lastCompleted(column.tasks, DONE_COLLAPSE) : column.tasks;
        return shown.map((task) => task.id);
      }),
    [columns, groupBy, showAllDone]
  );

  const applyDrop = useCallback((taskId: string, columnKey: string): void => {
    const task = (tasks ?? []).find((t) => t.id === taskId);
    if (!task) return;
    if (groupBy === "status" && task.status !== columnKey) {
      updateTask.mutate({ taskId, input: { status: columnKey as TaskStatus } });
    } else if (groupBy === "project") {
      const next = columnKey === NO_PROJECT ? null : columnKey;
      if ((task.projectTag ?? null) === next) return;
      // Dropping into a column that is a real project links the task to it by
      // id (and the server re-derives the tag); a legacy free-form tag column
      // still just sets the tag.
      const project = next ? (projectList ?? []).find((p) => p.name === next) : undefined;
      updateTask.mutate({ taskId, input: project ? { projectId: project.id } : { projectTag: next, projectId: null } });
    } else if (groupBy === "priority" && task.priority !== columnKey) {
      updateTask.mutate({ taskId, input: { priority: columnKey as TaskPriority } });
    }
  }, [tasks, groupBy, projectList, updateTask]);

  // ↑/↓ moves the selection; Enter opens the detail Sheet.
  // Shift+←/→ moves the selected card to the adjacent droppable column.
  // Skip while a modal/sheet/field is open so we don't steal keys from the form.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!panelVisible || creating || editingId || pendingDelete) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (event.shiftKey) return;
        event.preventDefault();
        const next = nextListId(visibleTaskIds, selectedIdRef.current, event.key === "ArrowDown" ? 1 : -1);
        if (next) {
          selectedIdRef.current = next;
          setSelectedId(next);
        }
        return;
      }
      if (event.key === "Enter" && selectedIdRef.current) {
        event.preventDefault();
        setEditingId(selectedIdRef.current);
        return;
      }
      if (!selectedIdRef.current || !event.shiftKey) return;
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const droppable = columns.filter((column) => column.droppable);
      const currentIndex = droppable.findIndex((column) => column.tasks.some((task) => task.id === selectedIdRef.current));
      if (currentIndex < 0) return;
      const next = droppable[currentIndex + (event.key === "ArrowRight" ? 1 : -1)];
      if (!next) return;
      event.preventDefault();
      applyDrop(selectedIdRef.current, next.key);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelVisible, creating, editingId, pendingDelete, selectedId, columns, applyDrop, visibleTaskIds]);

  function confirmDelete(): void {
    const task = pendingDelete;
    if (!task) return;
    setPendingDelete(null);
    deleteTask.mutate(task.id, {
      onSuccess: () => {
        setEditingId((cur) => (cur === task.id ? null : cur));
        setSelectedId((cur) => (cur === task.id ? null : cur));
        toast({ title: "Задача удалена" });
      }
    });
  }

  async function create(values: TaskFormValues): Promise<void> {
    const input: CreateTaskInput = {
      title: values.title,
      description: values.description,
      dueAt: values.dueAt,
      projectId: values.projectId,
      parentId: values.parentId,
      priority: values.priority,
      recurrence: values.recurrence,
      dependencyIds: values.dependencyIds,
      startAt: values.startAt,
      estimatedMinutes: values.estimatedMinutes,
      milestoneId: values.milestoneId,
      ...(values.assigneeId !== undefined ? { assigneeId: values.assigneeId } : {})
    };
    await createTask.mutateAsync(input);
    setCreating(false);
    toast({ title: "Задача создана", tone: "success" });
  }

  async function saveEdit(taskId: string, values: TaskFormValues): Promise<void> {
    await updateTask.mutateAsync({
      taskId,
      input: {
        title: values.title,
        description: values.description,
        dueAt: values.dueAt,
        projectId: values.projectId,
        parentId: values.parentId,
        priority: values.priority,
        status: values.status,
        recurrence: values.recurrence,
        dependencyIds: values.dependencyIds,
        startAt: values.startAt,
        estimatedMinutes: values.estimatedMinutes,
        milestoneId: values.milestoneId,
        ...(values.assigneeId !== undefined ? { assigneeId: values.assigneeId } : {})
      }
    });
    setEditingId(null);
    toast({ title: "Сохранено", tone: "success" });
  }

  const total = tasks?.length ?? 0;
  const openCount = (tasks ?? []).filter((t) => !isTaskClosed(t.status)).length;

  return (
    <PanelShell>
      <PanelHeader
        icon={ListTodo}
        title="Задачи"
        subtitle={total ? `${openCount} открыто · ${total} всего` : undefined}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Новая задача
          </Button>
        }
      >
        <SavedViewsBar
          workspaceId={workspace?.id}
          projects={projectList ?? []}
          current={{
            search: query,
            projectId: projectFilter
          }}
          onApply={(criteria) => {
            setQuery(criteria.search);
            setProjectFilter(criteria.projectId);
          }}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск задач" className="pl-8" />
          </div>
          {projectChips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              <FilterChip active={projectFilter === null} onClick={() => setProjectFilter(null)}>
                Все
              </FilterChip>
              {projectChips.map((project) => (
                <FilterChip
                  key={project.id}
                  active={projectFilter === project.id}
                  onClick={() => setProjectFilter(project.id)}
                  color={project.name}
                >
                  {project.name}
                </FilterChip>
              ))}
            </div>
          ) : null}
          <SegmentedControl<GroupBy>
            value={groupBy}
            onChange={setGroupBy}
            size="sm"
            options={[
              { value: "status", label: "По статусу" },
              { value: "project", label: "По проекту" },
              { value: "priority", label: "По приоритету" },
              { value: "due", label: "По сроку" }
            ]}
          />
          <SegmentedControl<BoardView>
            value={view}
            onChange={(next) => {
              viewTouched.current = true;
              setView(next);
            }}
            size="sm"
            options={[
              { value: "board", label: "Доска" },
              { value: "list", label: "Список" }
            ]}
          />
          {teamOn ? (
            <FilterChip
              active={onlyMine}
              onClick={() => {
                onlyMineTouched.current = true;
                setOnlyMine((v) => !v);
              }}
            >
              Только мои
            </FilterChip>
          ) : null}
        </div>
      </PanelHeader>

      <div className="orion-scroll flex-1 overflow-auto p-6 [container-type:inline-size]">
        {isLoading ? (
          <div className="grid gap-4 [@container(min-width:640px)]:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={TriangleAlert}
            tone="danger"
            title="Не удалось загрузить задачи"
            description={describeError(error)}
            action={
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Повторить
              </Button>
            }
          />
        ) : total === 0 ? (
          <EmptyState
            icon={ListTodo}
            title="Пока нет задач"
            description="Заведите первую — по ORION, Stella Mortis или GMap."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Новая задача
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title="Ничего не найдено"
            description="Сбросьте поиск или фильтр по проекту — в этом пространстве задачи есть."
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setProjectFilter(null);
                }}
              >
                Сбросить фильтры
              </Button>
            }
          />
        ) : (
          <div
            className={cx(
              view === "board"
                ? cx("grid gap-4", columns.length <= 3 ? "[@container(min-width:640px)]:grid-cols-3" : "[@container(min-width:640px)]:grid-cols-3 [@container(min-width:1152px)]:grid-cols-4")
                : "flex flex-col gap-4"
            )}
          >
            {columns.map((column) => (
              <section
                key={column.key}
                onDragOver={(e) => {
                  if (!column.droppable) return;
                  e.preventDefault();
                  setDragOverKey(column.key);
                }}
                onDragLeave={() => setDragOverKey((k) => (k === column.key ? null : k))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverKey(null);
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) applyDrop(id, column.key);
                }}
                className={cx(
                  "flex flex-col gap-2 rounded-2xl border p-2 transition-colors",
                  view === "list" && "w-full",
                  dragOverKey === column.key ? "border-accent bg-accent/[0.05]" : "border-border"
                )}
              >
                <div className="flex items-center gap-2 px-1 py-1">
                  {column.dot ? <span className={cx("h-1.5 w-1.5 rounded-full", column.dot)} /> : null}
                  <h2 className="text-label text-muted-foreground">{column.label}</h2>
                  <span className="text-micro text-subtle-foreground">{column.tasks.length}</span>
                  {groupBy === "status" && column.key === "todo" ? (
                    <button
                      type="button"
                      onClick={() => setCreating(true)}
                      className="ml-auto text-subtle-foreground hover:text-foreground"
                      aria-label="Добавить задачу"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>

                {(() => {
                  const collapsible = groupBy === "status" && column.key === "done" && !showAllDone;
                  const shown = collapsible ? lastCompleted(column.tasks, DONE_COLLAPSE) : column.tasks;
                  const hidden = column.tasks.length - shown.length;
                  if (column.tasks.length === 0) {
                    return (
                      <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-micro text-subtle-foreground">
                        Пусто
                      </p>
                    );
                  }
                  return (
                    <>
                      {shown.map((task, index) => (
                        <motion.div
                          key={task.id}
                          layout="position"
                          transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
                        >
                          <TaskCard
                            task={task}
                            draggable={column.droppable}
                            focused={task.id === focusedTaskId}
                            selected={task.id === selectedId}
                            subtasks={childProgress.get(task.id)}
                            assignee={assigneeOf(task)}
                            onSelect={() => setSelectedId(task.id)}
                            onOpen={() => setEditingId(task.id)}
                            onToggleDone={() =>
                              updateTask.mutate({
                                taskId: task.id,
                                input: { status: task.status === "done" ? "todo" : "done" }
                              })
                            }
                            onMove={(status) => updateTask.mutate({ taskId: task.id, input: { status } })}
                            onDelete={() => setPendingDelete(task)}
                            onMoveUp={
                              groupBy === "status" && canMoveNeighbor(column.tasks, task.id, -1)
                                ? () => moveToNeighbor(column.tasks, task.id, -1)
                                : undefined
                            }
                            onMoveDown={
                              groupBy === "status" &&
                              index < shown.length - 1 &&
                              canMoveNeighbor(column.tasks, task.id, 1)
                                ? () => moveToNeighbor(column.tasks, task.id, 1)
                                : undefined
                            }
                            onDropTask={
                              groupBy === "status" && column.droppable
                                ? (draggedId) => dropOnTask(column.key, column.tasks, draggedId, task.id)
                                : undefined
                            }
                          />
                        </motion.div>
                      ))}
                      {hidden > 0 ? (
                        <button
                          type="button"
                          onClick={() => setShowAllDone(true)}
                          className="rounded-lg border border-dashed border-border px-3 py-2 text-micro text-muted-foreground hover:text-foreground"
                        >
                          Показать все ({hidden} ещё)
                        </button>
                      ) : null}
                    </>
                  );
                })()}
              </section>
            ))}
          </div>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Новая задача" size="md">
        <TaskForm
          projects={isEnabled("projects") ? (projectList ?? []) : undefined}
          members={teamOn ? (memberList ?? []) : undefined}
          tasks={tasks ?? []}
          milestones={isEnabled("projects") ? (milestoneList ?? []) : undefined}
          parentOptions={parentSelectOptions}
          busy={createTask.isPending}
          submitLabel="Создать"
          onCancel={() => setCreating(false)}
          onSubmit={(values) => create(values)}
        />
      </Modal>

      <Sheet open={Boolean(editing)} onClose={() => setEditingId(null)} title="Задача">
        {editing ? (
          <div className="flex flex-col">
            <TaskForm
              key={editing.id}
              projects={isEnabled("projects") ? (projectList ?? []) : undefined}
              members={teamOn ? (memberList ?? []) : undefined}
              tasks={tasks ?? []}
              milestones={isEnabled("projects") ? (milestoneList ?? []) : undefined}
              parentOptions={parentSelectOptions}
              initial={editing}
              withStatus
              busy={updateTask.isPending}
              submitLabel="Сохранить"
              onCancel={() => setEditingId(null)}
              onDelete={() => setPendingDelete(editing)}
              onSubmit={(values) => saveEdit(editing.id, values)}
            />
            <SubtaskList
              key={editing.id}
              workspaceId={workspace?.id}
              parent={editing}
              tasks={tasks ?? []}
              onOpen={setEditingId}
            />
            <div className="mt-4 border-t border-border pt-3">
              <EntityLinksSection workspaceId={workspace?.id} type="task" id={editing.id} />
            </div>
            <div className="mt-4 border-t border-border pt-3">
              <TaskCommentsSection workspaceId={workspace?.id} taskId={editing.id} />
            </div>
          </div>
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить задачу?"
        description={pendingDelete ? `«${pendingDelete.title}» — действие необратимо.` : undefined}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </PanelShell>
  );
}

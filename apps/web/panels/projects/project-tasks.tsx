"use client";

import { useCreateTask, useDeleteTask, useUpdateTask, useWorkspaceMembers } from "@orion/core-react";
import type { Milestone, Project, Task, TaskStatus, UpdateTaskInput } from "@orion/shared-types";
import { Button, ConfirmDialog, EmptyState, PanelSection, SegmentedControl, Skeleton, cx, useResizeWidth, useToast } from "@orion/ui";
import { ListTodo, Milestone as MilestoneIcon, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useObjectNavigation } from "../../lib/use-object-navigation";
import { describeError } from "../../lib/error-message";
import { groupTasksByMilestone } from "../../lib/project-focus";
import { shortDate } from "../../lib/format";
import { useEnabledPlugins } from "../../lib/use-enabled-plugins";
import { TASK_STATUS_LABEL } from "../task-form";
import { TaskCard } from "../tasks/task-card";
import { parentOptions, subtaskProgressMap } from "../../lib/task-structure";
import { DetailSlot, TaskDetail } from "../tasks/task-detail";
import { TaskMatrix } from "./task-matrix";
import { TaskRow } from "./task-row";
import { TaskDependencyGraph, TaskTree } from "./task-tree";

type TasksLayout = "matrix" | "board" | "list" | "tree" | "graph";
const LAYOUT_KEY = "orion.project-tasks-layout";
/** Panel width from which the open task sits beside the view instead of replacing it. */
const DETAIL_SPLIT_MIN = 980;

const BOARD_COLUMNS: TaskStatus[] = ["backlog", "todo", "in_progress", "done"];
const DONE_VISIBLE = 5;

/**
 * A project's tasks, in the project: matrix (direction × urgency), board (by status),
 * list (by milestone), tree (subtasks) or links (dependency graph). A task opens in a detail pane here — the same pane the
 * general Tasks panel uses — so working on a project never throws you out to another
 * panel. The general panel stays the place for "all tasks"; this one is this project's.
 */
export function ProjectTasks({
  workspaceId,
  tasks,
  allTasks,
  milestones,
  projects,
  loading,
  timeOn,
  openTaskId,
  onOpenTask: navigateToTask,
  onToggle,
  onAddTask,
  onChanged
}: {
  workspaceId: string | undefined;
  /** Only this project's tasks. */
  tasks: Task[];
  /** Every task of the workspace — dependencies and subtasks may point outside the project. */
  allTasks: Task[];
  milestones: Milestone[];
  projects: Project[];
  loading: boolean;
  timeOn: boolean;
  openTaskId: string | null;
  onOpenTask: (taskId: string | null) => void;
  onToggle: (task: Task) => void;
  onAddTask: () => void;
  /** Called after a change that affects project rollups (progress, counts). */
  onChanged: () => void;
}): React.ReactElement {
  const { toast } = useToast();
  const allowObjectNavigation = useObjectNavigation(workspaceId);
  function onOpenTask(id: string | null): void {
    if (allowObjectNavigation(id)) navigateToTask(id);
  }
  const updateTask = useUpdateTask(workspaceId);
  const createTask = useCreateTask(workspaceId);
  const deleteTask = useDeleteTask(workspaceId);
  const { isEnabled: isPluginEnabled } = useEnabledPlugins();
  const teamOn = isPluginEnabled("team");
  const { data: members } = useWorkspaceMembers(teamOn ? workspaceId : undefined);

  const [layout, setLayout] = useState<TasksLayout>("matrix");
  const [showClosed, setShowClosed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved === "list" || saved === "board" || saved === "matrix" || saved === "tree" || saved === "graph") setLayout(saved);
    } catch {
      /* a remembered layout is a convenience only */
    }
  }, []);
  function chooseLayout(next: TasksLayout): void {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      /* ignore */
    }
  }

  const [frameRef, frameWidth] = useResizeWidth<HTMLDivElement>();
  const split = frameWidth >= DETAIL_SPLIT_MIN;
  const opened = openTaskId ? allTasks.find((task) => task.id === openTaskId) ?? null : null;
  const showDetail = opened !== null;
  const hideMain = showDetail && !split;

  async function saveTaskPatch(taskId: string, patch: UpdateTaskInput): Promise<Task> {
    const saved = await updateTask.mutateAsync({ taskId, input: patch });
    onChanged();
    return saved;
  }
  function setStatus(task: Task, status: TaskStatus): void {
    if (task.status === status) return;
    updateTask.mutate(
      { taskId: task.id, input: { status } },
      { onSuccess: onChanged, onError: () => toast({ title: "Не удалось изменить статус", tone: "danger" }) }
    );
  }
  // ORION-03: dragging a card between the Eisenhower matrix's importance columns — the matrix's
  // own transparent rule is `priority === "high"`, so this is exactly that field, not a new one.
  function setPriority(task: Task, priority: Task["priority"]): void {
    if (task.priority === priority) return;
    updateTask.mutate(
      { taskId: task.id, input: { priority } },
      { onSuccess: onChanged, onError: () => toast({ title: "Не удалось изменить приоритет", tone: "danger" }) }
    );
  }
  function moveToMilestone(task: Task, milestoneId: string | null): void {
    updateTask.mutate(
      { taskId: task.id, input: { milestoneId } },
      { onSuccess: onChanged, onError: () => toast({ title: "Не удалось перенести задачу", tone: "danger" }) }
    );
  }
  // ORION-02: drag-to-reparent in the tree. The server re-checks cycles/ownership regardless of
  // the client-side guard in TaskTree — this mutation is the same `parentId` edit the detail
  // pane's "Родитель" select already makes, just triggered by a drop instead of a form submit.
  function reparentTask(taskId: string, parentId: string | null): void {
    const task = allTasks.find((t) => t.id === taskId);
    const before = task?.parentId ?? null;
    if (before === parentId) return;
    updateTask.mutate(
      { taskId, input: { parentId } },
      {
        onSuccess: () => {
          onChanged();
          toast({
            title: parentId ? "Задача перенесена" : "Задача стала верхнего уровня",
            action: {
              label: "Отменить",
              onClick: () => updateTask.mutate({ taskId, input: { parentId: before } }, { onSuccess: onChanged, onError: () => toast({ title: "Не удалось вернуть", tone: "danger" }) })
            }
          });
        },
        onError: () => toast({ title: "Не удалось перенести задачу", description: "Возможно, это создало бы цикл подзадач.", tone: "danger" })
      }
    );
  }
  function createChildTask(parent: Task, title: string): void {
    createTask.mutate(
      { title, description: "", priority: "normal", checklist: [], parentId: parent.id, projectId: parent.projectId, milestoneId: parent.milestoneId },
      { onSuccess: onChanged, onError: () => toast({ title: "Не удалось создать подзадачу", tone: "danger" }) }
    );
  }
  function renameTask(task: Task, title: string): void {
    updateTask.mutate(
      { taskId: task.id, input: { title } },
      { onSuccess: onChanged, onError: () => toast({ title: "Не удалось переименовать", tone: "danger" }) }
    );
  }
  // ORION-01: the server is the real cycle guard (`assertDependenciesTx`) — this just sends the
  // same `dependencyIds` edit the detail pane's checklist already makes, from a click on the graph.
  function linkTasks(fromTaskId: string, toTaskId: string): void {
    const target = allTasks.find((t) => t.id === toTaskId);
    if (!target || target.dependencyIds.includes(fromTaskId)) return;
    updateTask.mutate(
      { taskId: toTaskId, input: { dependencyIds: [...target.dependencyIds, fromTaskId] } },
      { onSuccess: onChanged, onError: (error) => toast({ title: "Не удалось связать задачи", description: describeError(error), tone: "danger" }) }
    );
  }
  function unlinkTasks(fromTaskId: string, toTaskId: string): void {
    const target = allTasks.find((t) => t.id === toTaskId);
    if (!target) return;
    updateTask.mutate(
      { taskId: toTaskId, input: { dependencyIds: target.dependencyIds.filter((id) => id !== fromTaskId) } },
      { onSuccess: onChanged, onError: () => toast({ title: "Не удалось убрать связь", tone: "danger" }) }
    );
  }
  function confirmDelete(): void {
    const task = pendingDelete;
    if (!task) return;
    setPendingDelete(null);
    deleteTask.mutate(task.id, {
      onSuccess: () => {
        if (openTaskId === task.id) navigateToTask(null);
        onChanged();
        toast({ title: "Задача удалена" });
      },
      onError: () => toast({ title: "Не удалось удалить задачу", tone: "danger" })
    });
  }

  const parentChoices = useMemo(() => parentOptions(allTasks, opened?.id), [allTasks, opened?.id]);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={ListTodo}
        title="В проекте нет задач"
        description="Разбейте проект на шаги — прогресс и «Дальше» считаются по ним."
        action={
          <Button size="sm" onClick={onAddTask}>
            <Plus className="h-4 w-4" /> Задача
          </Button>
        }
      />
    );
  }

  return (
    <div ref={frameRef} className={cx("flex min-h-0 gap-4", split && showDetail ? "items-start" : "flex-col")}>
      {!hideMain ? (
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl<TasksLayout>
              aria-label="Вид задач"
              value={layout}
              onChange={chooseLayout}
              size="sm"
              options={[
                { value: "matrix", label: "Матрица" },
                { value: "board", label: "Доска" },
                { value: "list", label: "Список" },
                { value: "tree", label: "Дерево" },
                { value: "graph", label: "Связи" }
              ]}
            />
            <SegmentedControl<"open" | "all">
              aria-label="Какие задачи показывать"
              value={showClosed ? "all" : "open"}
              onChange={(value) => setShowClosed(value === "all")}
              size="sm"
              options={[
                { value: "open", label: "Открытые" },
                { value: "all", label: "Все" }
              ]}
            />
          </div>

          {layout === "matrix" ? (
            <TaskMatrix
              tasks={tasks}
              milestones={milestones}
              includeClosed={showClosed}
              onToggle={onToggle}
              onOpen={(task) => onOpenTask(task.id)}
              onMove={moveToMilestone}
              onPriorityChange={setPriority}
            />
          ) : layout === "tree" ? (
            <TaskTree
              tasks={tasks}
              showClosed={showClosed}
              openTaskId={openTaskId}
              onToggle={onToggle}
              onOpen={(task) => onOpenTask(task.id)}
              onReparent={reparentTask}
              onCreateChild={createChildTask}
              onRename={renameTask}
            />
          ) : layout === "graph" ? (
            <TaskDependencyGraph
              tasks={allTasks}
              showClosed={showClosed}
              openTaskId={openTaskId}
              onOpen={(task) => onOpenTask(task.id)}
              onLink={linkTasks}
              onUnlink={unlinkTasks}
            />
          ) : layout === "board" ? (
            <ProjectBoard
              tasks={tasks}
              showClosed={showClosed}
              openTaskId={openTaskId}
              onOpen={(task) => onOpenTask(task.id)}
              onToggle={onToggle}
              onStatus={setStatus}
              onDelete={setPendingDelete}
            />
          ) : (
            <ProjectList tasks={tasks} milestones={milestones} showClosed={showClosed} onToggle={onToggle} onOpen={(task) => onOpenTask(task.id)} />
          )}
        </div>
      ) : null}

      {opened ? (
        <DetailSlot
          split={split}
          className={cx(
            "min-w-0 overflow-hidden rounded-xl border border-border",
            split ? "sticky top-0 h-[calc(100dvh-14rem)] min-h-[28rem]" : "min-h-[28rem]"
          )}
        >
          <TaskDetail
            key={opened.id}
            task={opened}
            workspaceId={workspaceId}
            projects={projects}
            members={teamOn ? (members ?? []) : undefined}
            tasks={allTasks}
            milestones={milestones}
            parentOptions={parentChoices}
            timeOn={timeOn}
            compact={!split}
            onSave={saveTaskPatch}
            onClose={() => onOpenTask(null)}
            onDelete={() => setPendingDelete(opened)}
            onOpenTask={(id) => onOpenTask(id)}
          />
        </DetailSlot>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить задачу?"
        description={pendingDelete ? `«${pendingDelete.title}» — действие необратимо.` : undefined}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Доска
// ---------------------------------------------------------------------------

function ProjectBoard({
  tasks,
  showClosed,
  openTaskId,
  onOpen,
  onToggle,
  onStatus,
  onDelete
}: {
  tasks: Task[];
  showClosed: boolean;
  openTaskId: string | null;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  onStatus: (task: Task, status: TaskStatus) => void;
  onDelete: (task: Task) => void;
}): React.ReactElement {
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null);
  const [expandedDone, setExpandedDone] = useState(false);
  const progress = useMemo(() => subtaskProgressMap(tasks), [tasks]);
  const columns: TaskStatus[] = showClosed ? [...BOARD_COLUMNS, "canceled"] : BOARD_COLUMNS;

  const byStatus = (status: TaskStatus): Task[] =>
    tasks
      .filter((task) => task.status === status)
      .sort((a, b) =>
        status === "done" || status === "canceled"
          ? (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt)
          : a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)
      );

  function drop(status: TaskStatus, event: React.DragEvent): void {
    event.preventDefault();
    setOverStatus(null);
    const task = tasks.find((candidate) => candidate.id === event.dataTransfer.getData("text/plain"));
    if (task) onStatus(task, status);
  }

  return (
    <div className="orion-scroll overflow-x-auto pb-1">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(15rem, 1fr))` }}>
        {columns.map((status) => {
          const all = byStatus(status);
          // «Готово» keeps to the latest few unless asked for more: the open work is the point of the board.
          const collapsed = status === "done" && !showClosed && !expandedDone && all.length > DONE_VISIBLE;
          const shown = collapsed ? all.slice(0, DONE_VISIBLE) : all;
          return (
            <section
              key={status}
              onDragOver={(event) => {
                event.preventDefault();
                setOverStatus(status);
              }}
              onDragLeave={() => setOverStatus((cur) => (cur === status ? null : cur))}
              onDrop={(event) => drop(status, event)}
              aria-label={TASK_STATUS_LABEL[status]}
              className={cx(
                "flex min-h-[8rem] flex-col gap-2 rounded-2xl border p-2 transition-colors",
                overStatus === status ? "border-accent bg-accent/[0.05]" : "border-border"
              )}
            >
              <h3 className="flex items-center gap-2 px-1 py-1 text-label text-muted-foreground">
                {TASK_STATUS_LABEL[status]}
                <span className="text-micro text-subtle-foreground">{all.length}</span>
              </h3>
              {shown.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-micro text-subtle-foreground">Пусто</p>
              ) : (
                shown.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    draggable
                    focused={task.id === openTaskId}
                    subtasks={progress.get(task.id)}
                    onOpen={() => onOpen(task)}
                    onToggleDone={() => onToggle(task)}
                    onMove={(next) => onStatus(task, next)}
                    onDelete={() => onDelete(task)}
                    hideProject
                  />
                ))
              )}
              {collapsed ? (
                <button
                  type="button"
                  onClick={() => setExpandedDone(true)}
                  className="rounded-lg border border-dashed border-border px-3 py-2 text-micro text-muted-foreground hover:text-foreground"
                >
                  Показать все ({all.length - shown.length} ещё)
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Список
// ---------------------------------------------------------------------------

function ProjectList({
  tasks,
  milestones,
  showClosed,
  onToggle,
  onOpen
}: {
  tasks: Task[];
  milestones: Milestone[];
  showClosed: boolean;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
}): React.ReactElement {
  const groups = useMemo(() => groupTasksByMilestone(tasks, milestones, showClosed), [tasks, milestones, showClosed]);
  const now = new Date();
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      {groups.map((group) => {
        const total = group.open + group.closed;
        return (
          <PanelSection
            key={group.milestone?.id ?? "none"}
            title={
              <span className="inline-flex items-center gap-1.5">
                {group.milestone ? <MilestoneIcon className="h-3 w-3" aria-hidden /> : null}
                {group.milestone?.title ?? "Без вехи"}
                <span className="font-mono normal-case tabular-nums">
                  · {group.closed}/{total}
                </span>
                {group.milestone?.dueAt ? <span className="normal-case">· до {shortDate(group.milestone.dueAt)}</span> : null}
              </span>
            }
          >
            {group.tasks.length === 0 ? (
              <p className="px-2 text-label text-subtle-foreground">{total === 0 ? "Задач у вехи пока нет." : "Всё закрыто."}</p>
            ) : (
              <ul className="flex flex-col">
                {group.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} now={now} onToggle={() => onToggle(task)} onOpen={() => onOpen(task)} />
                ))}
              </ul>
            )}
          </PanelSection>
        );
      })}
    </div>
  );
}


"use client";

import {
  useArchiveProject,
  useCreateNote,
  useCreateTask,
  useMilestones,
  useProject,
  useProjects,
  useTasks,
  useUpdateProject,
  useUpdateTask
} from "@orion/core-react";
import {
  formatDuration,
  isProjectOverdue,
  type Milestone,
  type ProjectActivity,
  type ProjectDetail,
  type Task,
  type TaskStatus
} from "@orion/shared-types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ContextNoteField,
  DropdownMenu,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PanelBody,
  PanelHeader,
  PanelSection,
  PanelShell,
  SegmentedControl,
  Skeleton,
  Textarea,
  cx,
  useToast
} from "@orion/ui";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  FileText,
  FolderKanban,
  ExternalLink,
  FolderOpen,
  GanttChartSquare,
  ListTodo,
  Milestone as MilestoneIcon,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Receipt,
  Timer,
  TriangleAlert
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EntityLinksSection } from "../components/entity-links";
import { ShareGrantSection } from "../components/share-grant-section";
import { describeError } from "../lib/error-message";
import { formatMoney, relativeTime, shortDate, shortDateTime } from "../lib/format";
import { focusDocument, focusNote, focusTask, focusTransaction, focusEvent, openPanel } from "../lib/panel-bus";
import { detachPanelToWindow } from "../lib/panel-window";
import type { PanelComponentProps } from "../lib/panel-registry";
import { projectFocus } from "../lib/project-focus";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { ProjectForm, projectSwatchColor, type ProjectFormValues } from "./project-form";
import { Meter, ReportedHealthBadge, taskProgressLabel } from "./projects/project-bits";
import { ProjectPlan } from "./projects/plan-views";
import { ProjectMaterials } from "./projects/materials";
import { ProjectTasks } from "./projects/project-tasks";
import { TaskRow } from "./projects/task-row";
import { DueChip, PlanEmptyHint, PlanStrip, ProjectStatusMenu } from "./projects/project-vitals";
import { ProjectStatusSection } from "./projects/status-updates";
import { TASK_STATUS_LABEL, TaskForm, type TaskFormValues } from "./task-form";

type ProjectTab = "overview" | "tasks" | "plan" | "materials" | "access";

const PROJECT_TABS: readonly ProjectTab[] = ["overview", "tasks", "plan", "materials", "access"];
/** Per-viewer, per-project: which view of the project this person last used. */
const projectTabKey = (projectId: string): string => `orion.project-tab.${projectId}`;

const ACTIVITY_ICON: Record<ProjectActivity["type"], React.ComponentType<{ className?: string }>> = {
  task: ListTodo,
  note: FileText,
  event: CalendarDays,
  document: FolderOpen,
  transaction: Receipt,
  milestone: MilestoneIcon,
  inventory: Package
};

const ACTIVITY_LABEL: Record<ProjectActivity["type"], string> = {
  task: "Задача",
  note: "Заметка",
  event: "Событие",
  document: "Файл",
  transaction: "Операция",
  milestone: "Веха",
  inventory: "Позиция склада"
};

const TRANSACTION_TYPE_LABEL: Record<string, string> = {
  expense: "Расход",
  income: "Доход",
  transfer: "Перевод"
};

function activityStatusLabel(item: ProjectActivity): string | null {
  if (!item.status) return null;
  if (item.type === "task") return TASK_STATUS_LABEL[item.status as TaskStatus] ?? item.status;
  if (item.type === "transaction") return TRANSACTION_TYPE_LABEL[item.status] ?? item.status;
  return item.status;
}

/**
 * A project's own dock tab (`project:<id>`, see `openProject` in panel-bus).
 * It replaced the detail Sheet over the project board: a project is a
 * container you work inside, and the Sheet showed counters ("1/5",
 * "Заметки: 3") in 40rem instead of the work itself. The overview leads
 * with what's next, what's on fire and the nearest milestone; tasks, the
 * plan and materials each get the full panel width in their own tab; deadline, money
 * and time live on the overview as one card each instead of a tab of mostly empty fields.
 */
export function ProjectWorkspacePanel({ params, api }: PanelComponentProps): React.ReactElement {
  const projectId = params?.instanceId;
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { data: project, isLoading, isError, error, refetch, isFetched } = useProject(workspaceId, projectId);

  // The tab was opened with the name the caller knew (or just "Проект" after
  // a layout restore) — keep it in sync with the real, possibly renamed, project.
  const projectName = project?.name;
  useEffect(() => {
    if (projectName) api?.setTitle(projectName);
  }, [api, projectName]);

  if (!projectId) {
    return (
      <PanelShell>
        <PanelBody>
          <EmptyState icon={FolderKanban} title="Проект не выбран" description="Откройте проект из списка «Проекты»." />
        </PanelBody>
      </PanelShell>
    );
  }

  if (isError) {
    return (
      <PanelShell>
        <PanelBody>
          <EmptyState
            icon={TriangleAlert}
            tone="danger"
            title="Не удалось загрузить проект"
            description={describeError(error)}
            action={
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Повторить
              </Button>
            }
          />
        </PanelBody>
      </PanelShell>
    );
  }

  if (isLoading || !project) {
    return (
      <PanelShell>
        <PanelBody className="[container-type:inline-size]">
          {isFetched && !project ? (
            <EmptyState icon={FolderKanban} title="Проект не найден" description="Возможно, он был удалён или недоступен." />
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-full max-w-xl" />
              <div className="grid gap-4 [@container(min-width:1152px)]:grid-cols-[minmax(0,1fr)_22rem]">
                <Skeleton className="h-72 w-full" />
                <Skeleton className="h-72 w-full" />
              </div>
            </div>
          )}
        </PanelBody>
      </PanelShell>
    );
  }

  return <ProjectWorkspace key={project.id} workspaceId={workspaceId} project={project} />;
}

function ProjectWorkspace({
  workspaceId,
  project
}: {
  workspaceId: string | undefined;
  project: ProjectDetail;
}): React.ReactElement {
  const { isEnabled } = useEnabledModules();
  const tasksOn = isEnabled("tasks");
  const notesOn = isEnabled("notes");
  const documentsOn = isEnabled("documents");
  const financeOn = isEnabled("finance");
  const timeOn = isEnabled("time");

  const { data: allTasks, isLoading: tasksLoading } = useTasks(tasksOn ? workspaceId : undefined);
  const { data: milestones } = useMilestones(workspaceId, project.id);
  const { data: workspaceProjects } = useProjects(workspaceId);
  const updateProject = useUpdateProject(workspaceId);
  const archiveProject = useArchiveProject(workspaceId);
  const updateTask = useUpdateTask(workspaceId);
  const createTask = useCreateTask(tasksOn ? workspaceId : undefined);
  const createNote = useCreateNote(notesOn ? workspaceId : undefined);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [chosenTab, setChosenTab] = useState<ProjectTab>("overview");
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [adding, setAdding] = useState<"task" | "note" | null>(null);
  // The task open in this project's detail pane. Lifted here so the overview rows can open it too.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const tasks = useMemo(() => (allTasks ?? []).filter((task) => task.projectId === project.id), [allTasks, project.id]);
  const milestoneList = useMemo(() => milestones ?? [], [milestones]);
  // Ask for more than the five shown: the overview drops tasks already listed under «Горит».
  const focus = useMemo(() => projectFocus(tasks, milestoneList, new Date(), 12), [tasks, milestoneList]);

  const projectOptions = useMemo(() => {
    const list = workspaceProjects ?? [];
    return list.some((item) => item.id === project.id) ? list : [project, ...list];
  }, [workspaceProjects, project]);

  const tabs: { value: ProjectTab; label: React.ReactNode }[] = [
    { value: "overview", label: "Обзор" },
    ...(tasksOn ? [{ value: "tasks" as const, label: `Задачи${focus.open > 0 ? ` · ${focus.open}` : ""}` }] : []),
    ...(tasksOn ? [{ value: "plan" as const, label: "План" }] : []),
    { value: "materials", label: "Материалы" },
    { value: "access", label: "Доступ" }
  ];

  // A remembered tab can name a module that is off now — fall back to the overview
  // instead of rendering a view whose data this project can't show.
  const tab: ProjectTab = tabs.some((item) => item.value === chosenTab) ? chosenTab : "overview";

  useEffect(() => {
    try {
      const saved = localStorage.getItem(projectTabKey(project.id));
      if (saved && (PROJECT_TABS as readonly string[]).includes(saved)) setChosenTab(saved as ProjectTab);
    } catch {
      /* storage is a convenience only */
    }
  }, [project.id]);

  function setTab(next: ProjectTab): void {
    setChosenTab(next);
    try {
      localStorage.setItem(projectTabKey(project.id), next);
    } catch {
      /* storage is a convenience only */
    }
  }

  function refreshProject(): void {
    void queryClient.invalidateQueries({ queryKey: ["project", workspaceId, project.id] });
    void queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
  }

  function toggleTask(task: Task): void {
    updateTask.mutate(
      { taskId: task.id, input: { status: task.status === "done" ? "todo" : "done" } },
      {
        onSuccess: refreshProject,
        onError: () => toast({ title: "Не удалось обновить задачу", tone: "danger" })
      }
    );
  }

  async function save(values: ProjectFormValues): Promise<void> {
    try {
      await updateProject.mutateAsync({ projectId: project.id, input: values });
      setEditing(false);
      toast({ title: "Сохранено", tone: "success" });
    } catch {
      toast({ title: "Не удалось сохранить", tone: "danger" });
    }
  }

  function confirmArchiveNow(): void {
    setConfirmArchive(false);
    archiveProject.mutate(project.id, {
      onSuccess: () => {
        toast({ title: "Проект в архиве", tone: "default" });
        refreshProject();
      },
      onError: () => toast({ title: "Не удалось архивировать", tone: "danger" })
    });
  }

  function restore(): void {
    updateProject.mutate(
      { projectId: project.id, input: { archivedAt: null } },
      {
        onSuccess: () => toast({ title: "Проект восстановлен", tone: "success" }),
        onError: () => toast({ title: "Не удалось восстановить", tone: "danger" })
      }
    );
  }

  async function addTask(values: TaskFormValues): Promise<void> {
    try {
      await createTask.mutateAsync({
        title: values.title,
        description: values.description,
        dueAt: values.dueAt,
        projectId: values.projectId ?? project.id,
        parentId: values.parentId,
        priority: values.priority,
        recurrence: values.recurrence,
        dependencyIds: values.dependencyIds,
        startAt: values.startAt,
        estimatedMinutes: values.estimatedMinutes,
        milestoneId: values.milestoneId
      });
      setAdding(null);
      toast({ title: "Задача создана", tone: "success" });
      refreshProject();
    } catch {
      toast({ title: "Не удалось создать задачу", tone: "danger" });
    }
  }

  async function addNote(title: string, body: string): Promise<void> {
    try {
      await createNote.mutateAsync({ title, body, tags: [], projectId: project.id });
      setAdding(null);
      toast({ title: "Заметка создана", tone: "success" });
      refreshProject();
    } catch {
      toast({ title: "Не удалось создать заметку", tone: "danger" });
    }
  }

  const swatch = projectSwatchColor(project.color);
  const progress = Math.min(100, Math.max(0, project.progress));

  return (
    <PanelShell>
      <PanelHeader
        icon={FolderKanban}
        title={
          <span className="inline-flex items-center gap-2">
            {swatch ? <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: swatch }} aria-hidden /> : null}
            {project.name}
          </span>
        }
        subtitle={project.description || undefined}
        actions={
          <>
            {tasksOn ? (
              <Button size="sm" onClick={() => setAdding("task")}>
                <Plus className="h-4 w-4" /> Задача
              </Button>
            ) : null}
            <DropdownMenu
              align="end"
              trigger={({ toggle }) => (
                <IconButton label="Действия с проектом" size="sm" onClick={toggle}>
                  <MoreHorizontal className="h-4 w-4" />
                </IconButton>
              )}
              items={[
                ...(notesOn ? [{ label: "Новая заметка", icon: FileText, onSelect: () => setAdding("note") }] : []),
                { label: "Изменить проект", icon: Pencil, onSelect: () => setEditing(true) },
                "separator" as const,
                // The same plan / materials the tabs show, as panels of their own: beside the
                // overview, or in a separate window (second monitor). Same data, no copies.
                ...(tasksOn
                  ? [
                      { label: "План панелью", icon: GanttChartSquare, onSelect: () => openPanel(`projectplan:${project.id}`, `План · ${project.name}`) },
                      { label: "План окном", icon: ExternalLink, onSelect: () => void detachPanelToWindow(`projectplan:${project.id}`, `План · ${project.name}`) }
                    ]
                  : []),
                { label: "Материалы панелью", icon: FolderOpen, onSelect: () => openPanel(`projectmaterials:${project.id}`, `Материалы · ${project.name}`) },
                { label: "Материалы окном", icon: ExternalLink, onSelect: () => void detachPanelToWindow(`projectmaterials:${project.id}`, `Материалы · ${project.name}`) },
                "separator" as const,
                project.archivedAt
                  ? { label: "Восстановить из архива", icon: ArchiveRestore, onSelect: restore }
                  : { label: "В архив", icon: Archive, onSelect: () => setConfirmArchive(true) }
              ]}
            />
          </>
        }
      >
        <div className="flex w-full flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {project.archivedAt ? <Badge>В архиве</Badge> : null}
            <ReportedHealthBadge project={project} />
            <ProjectStatusMenu
              status={project.status}
              disabled={updateProject.isPending || Boolean(project.archivedAt)}
              onChange={(status) =>
                updateProject.mutate(
                  { projectId: project.id, input: { status } },
                  { onError: () => toast({ title: "Не удалось изменить статус", tone: "danger" }) }
                )
              }
            />
            <DueChip project={project} />
            {tasksOn ? (
              <span className="flex items-center gap-2">
                <span className="w-24">
                  <Meter value={progress} tone={progress === 100 ? "success" : "accent"} color={swatch} />
                </span>
                <span className="text-micro text-subtle-foreground">{taskProgressLabel(project)}</span>
              </span>
            ) : null}
            {/* One line of the numbers that matter, shown only where there is something to show. */}
            {financeOn && (project.budgetAmount !== null || project.spentAmount > 0) ? (
              <span title="Потрачено по проекту">
                <Badge tone={project.budgetAmount !== null && project.spentAmount > project.budgetAmount ? "danger" : "neutral"}>
                  {formatMoney(project.spentAmount, project.currency)}
                  {project.budgetAmount !== null ? ` из ${formatMoney(project.budgetAmount, project.currency)}` : ""}
                </Badge>
              </span>
            ) : null}
            {timeOn && project.trackedMinutes > 0 ? (
              <span title="Учтено времени">
                <Badge tone="neutral">{formatDuration(project.trackedMinutes)}</Badge>
              </span>
            ) : null}
          </div>
          <SegmentedControl<ProjectTab> value={tab} onChange={setTab} size="sm" options={tabs} />
        </div>
      </PanelHeader>

      <PanelBody className="[container-type:inline-size]">
        {tab === "overview" ? (
          <OverviewTab
            workspaceId={workspaceId}
            project={project}
            focus={focus}
            milestones={milestoneList}
            tasks={tasks}
            tasksOn={tasksOn}
            tasksLoading={tasksOn && tasksLoading}
            timeOn={timeOn}
            financeOn={financeOn}
            busyNote={updateProject.isPending}
            onSaveNote={(contextNote) => updateProject.mutate({ projectId: project.id, input: { contextNote } })}
            onToggle={toggleTask}
            onGoTo={setTab}
            onEditProject={() => setEditing(true)}
            onOpenTask={(task) => {
              setOpenTaskId(task.id);
              setTab("tasks");
            }}
            onAddTask={() => setAdding("task")}
          />
        ) : null}

        {tab === "tasks" ? (
          <ProjectTasks
            workspaceId={workspaceId}
            tasks={tasks}
            allTasks={allTasks ?? []}
            milestones={milestoneList}
            projects={projectOptions}
            loading={tasksLoading}
            timeOn={timeOn}
            openTaskId={openTaskId}
            onOpenTask={setOpenTaskId}
            onToggle={toggleTask}
            onAddTask={() => setAdding("task")}
            onChanged={refreshProject}
          />
        ) : null}

        {tab === "plan" ? <ProjectPlan projectId={project.id} /> : null}

        {tab === "materials" ? (
          <ProjectMaterials
            workspaceId={workspaceId}
            project={project}
            notesOn={notesOn}
            documentsOn={documentsOn}
            onAddNote={() => setAdding("note")}
          />
        ) : null}

        {tab === "access" ? (
          <div className="flex max-w-3xl flex-col gap-6">
            <ShareGrantSection workspaceId={workspaceId} type="project" id={project.id} />
            <PanelSection title="Архив">
              <p className="text-label text-muted-foreground">
                {project.archivedAt
                  ? `В архиве с ${shortDateTime(project.archivedAt)}. Задачи, заметки и связи сохранены.`
                  : "Архивированный проект уходит из списка, но задачи, заметки и связи сохраняются."}
              </p>
              {project.archivedAt ? (
                <Button size="sm" variant="outline" onClick={restore} disabled={updateProject.isPending}>
                  <ArchiveRestore className="h-4 w-4" /> Восстановить
                </Button>
              ) : (
                <Button size="sm" variant="subtle" onClick={() => setConfirmArchive(true)}>
                  <Archive className="h-4 w-4" /> В архив
                </Button>
              )}
            </PanelSection>
          </div>
        ) : null}
      </PanelBody>

      <Modal open={editing} onClose={() => setEditing(false)} title="Проект" size="md">
        <ProjectForm
          initial={project}
          busy={updateProject.isPending}
          submitLabel="Сохранить"
          onSubmit={save}
          onCancel={() => setEditing(false)}
        />
      </Modal>

      <Modal open={adding === "task"} onClose={() => setAdding(null)} title="Новая задача" size="md">
        <TaskForm
          key={project.id}
          projects={projectOptions}
          defaultProjectId={project.id}
          milestones={milestoneList}
          busy={createTask.isPending}
          submitLabel="Создать"
          onSubmit={addTask}
          onCancel={() => setAdding(null)}
        />
      </Modal>

      <Modal open={adding === "note"} onClose={() => setAdding(null)} title="Новая заметка" size="sm">
        <QuickNoteForm busy={createNote.isPending} onSubmit={addNote} onCancel={() => setAdding(null)} />
      </Modal>

      <ConfirmDialog
        open={confirmArchive}
        title="Отправить проект в архив?"
        description="Проект уйдёт в архив, связи с задачами и заметками сохранятся."
        confirmLabel="В архив"
        danger={false}
        onConfirm={confirmArchiveNow}
        onCancel={() => setConfirmArchive(false)}
      />
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Обзор
// ---------------------------------------------------------------------------

function OverviewTab({
  workspaceId,
  project,
  focus,
  milestones,
  tasks,
  tasksOn,
  tasksLoading,
  timeOn,
  financeOn,
  busyNote,
  onSaveNote,
  onToggle,
  onGoTo,
  onEditProject,
  onOpenTask,
  onAddTask
}: {
  workspaceId: string | undefined;
  project: ProjectDetail;
  focus: ReturnType<typeof projectFocus>;
  milestones: Milestone[];
  tasks: Task[];
  tasksOn: boolean;
  tasksLoading: boolean;
  timeOn: boolean;
  financeOn: boolean;
  busyNote: boolean;
  onSaveNote: (value: string) => void;
  onToggle: (task: Task) => void;
  onGoTo: (tab: ProjectTab) => void;
  onEditProject: () => void;
  onOpenTask: (task: Task) => void;
  onAddTask: () => void;
}): React.ReactElement {
  const progress = Math.min(100, Math.max(0, project.progress));
  const now = new Date();
  const fire = [...focus.overdue, ...focus.blocked];
  // A task on fire is shown there once; «Дальше» lists the rest of the actionable work.
  const fireIds = new Set(fire.map((task) => task.id));
  const upNext = focus.next.filter((task) => !fireIds.has(task.id)).slice(0, 5);

  return (
    <div className="grid grid-cols-1 gap-6 [@container(min-width:1152px)]:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <ProjectStatusSection
          workspaceId={workspaceId}
          projectId={project.id}
          project={project}
          overdueTasks={focus.overdue.length}
        />

        {tasksOn ? (
          <PanelSection
            title="План"
            actions={
              <Button size="sm" variant="ghost" onClick={() => onGoTo("plan")}>
                Открыть план
              </Button>
            }
          >
            {milestones.length > 0 ? (
              <PlanStrip milestones={milestones} tasks={tasks} onOpenPlan={() => onGoTo("plan")} />
            ) : (
              <PlanEmptyHint onOpenPlan={() => onGoTo("plan")} />
            )}
          </PanelSection>
        ) : null}

        {tasksOn && fire.length > 0 ? (
          <PanelSection title={`Горит · ${fire.length}`}>
            <Card className="border-destructive/30 px-2 py-1">
              <ul className="flex flex-col">
                {fire.map((task) => (
                  <TaskRow key={task.id} task={task} now={now} onToggle={() => onToggle(task)} onOpen={() => onOpenTask(task)} />
                ))}
              </ul>
            </Card>
          </PanelSection>
        ) : null}

        {tasksOn ? (
          <PanelSection
            title="Дальше"
            actions={
              focus.open > upNext.length + fire.length ? (
                <Button size="sm" variant="ghost" onClick={() => onGoTo("tasks")}>
                  Все открытые · {focus.open}
                </Button>
              ) : null
            }
          >
            {tasksLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : upNext.length === 0 ? (
              <EmptyState
                icon={ListTodo}
                title={focus.open === 0 ? "Открытых задач нет" : "Всё открытое уже в блоке «Горит»"}
                description={
                  focus.open === 0
                    ? "Добавьте следующий шаг — он появится здесь первым."
                    : "Разберите просроченные и заблокированные задачи — следующие появятся здесь."
                }
                action={
                  <Button size="sm" onClick={onAddTask}>
                    <Plus className="h-4 w-4" /> Задача
                  </Button>
                }
              />
            ) : (
              <ul className="flex flex-col">
                {upNext.map((task) => (
                  <TaskRow key={task.id} task={task} now={now} onToggle={() => onToggle(task)} onOpen={() => onOpenTask(task)} />
                ))}
              </ul>
            )}
          </PanelSection>
        ) : null}

        <ContextNoteField value={project.contextNote} busy={busyNote} onSave={onSaveNote} />

        <PanelSection title="Последние изменения">
          <ActivityList items={project.activity.slice(0, 8)} onPlan={() => onGoTo("plan")} />
        </PanelSection>
      </div>

      <aside className="flex min-w-0 flex-col gap-3">
        {tasksOn ? (
          <Card className="space-y-2 px-4 py-3">
            <SideTitle>Прогресс</SideTitle>
            <Meter value={progress} tone={progress === 100 ? "success" : "accent"} color={projectSwatchColor(project.color)} />
            <p className="text-label text-foreground">{taskProgressLabel(project)}</p>
            {focus.open > 0 ? (
              <p className="text-micro text-subtle-foreground">
                открыто {focus.open}
                {focus.inProgress > 0 ? ` · в работе ${focus.inProgress}` : ""}
                {focus.overdue.length > 0 ? ` · просрочено ${focus.overdue.length}` : ""}
              </p>
            ) : null}
          </Card>
        ) : null}

        <DeadlineCard project={project} />

        <MoneyTimeCard project={project} financeOn={financeOn} timeOn={timeOn} tasksOn={tasksOn} onEdit={onEditProject} />

        <Card className="px-4 py-3">
          <SideTitle>Состав</SideTitle>
          <ul className="mt-2 flex flex-col">
            <CompositionRow label="Заметки" value={String(project.counts.notes)} onClick={() => onGoTo("materials")} />
            <CompositionRow label="Файлы" value={String(project.counts.documents)} onClick={() => onGoTo("materials")} />
            <CompositionRow label="События" value={String(project.counts.events)} onClick={() => onGoTo("materials")} />
            {project.counts.inventory > 0 ? (
              <CompositionRow label="Склад" value={String(project.counts.inventory)} onClick={() => openPanel("inventory")} />
            ) : null}
          </ul>
          <p className="mt-2 text-micro text-subtle-foreground">
            {project.lastActivityAt ? `Последнее изменение ${relativeTime(project.lastActivityAt)}` : "Ещё не трогали"}
          </p>
        </Card>

        <Card className="space-y-1.5 px-4 py-3">
          <SideTitle>Связи</SideTitle>
          <EntityLinksSection workspaceId={workspaceId} type="project" id={project.id} />
        </Card>
      </aside>
    </div>
  );
}

function DeadlineCard({ project }: { project: ProjectDetail }): React.ReactElement | null {
  if (!project.dueAt && !project.startAt) return null;
  const overdue = isProjectOverdue(project);
  const schedule = schedulePercent(project.startAt, project.dueAt);
  const days = project.dueAt ? daysUntil(project.dueAt) : null;
  let headline = "Срок не задан";
  if (days !== null) {
    if (project.status === "completed") headline = "Завершён";
    else if (overdue) headline = `Просрочен на ${pluralDays(-days)}`;
    else if (days === 0) headline = "Срок сегодня";
    else headline = `Осталось ${pluralDays(days)}`;
  }
  return (
    <Card className="space-y-2 px-4 py-3">
      <SideTitle>Сроки</SideTitle>
      <p className={cx("text-label", overdue ? "text-destructive" : "text-foreground")}>{headline}</p>
      {schedule !== null ? <Meter value={schedule} tone={overdue ? "danger" : "accent"} /> : null}
      <p className="text-micro text-subtle-foreground">
        {project.startAt ? shortDate(project.startAt) : "…"} → {project.dueAt ? shortDate(project.dueAt) : "…"}
      </p>
    </Card>
  );
}

function SideTitle({ children }: { children: React.ReactNode }): React.ReactElement {
  return <h3 className="text-micro font-medium uppercase tracking-wide text-subtle-foreground">{children}</h3>;
}

function CompositionRow({
  label,
  value,
  danger,
  onClick
}: {
  label: string;
  value: string;
  danger?: boolean;
  onClick: () => void;
}): React.ReactElement {
  // A list of buttons, not a <dl>: a definition list may only contain term/description pairs,
  // and these rows are controls that jump to the matching tab.
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-card-hover"
      >
        <span className="text-label text-muted-foreground">{label}</span>
        <span className={cx("font-mono text-label tabular-nums", danger ? "text-destructive" : "text-foreground")}>{value}</span>
      </button>
    </li>
  );
}

/** A row is a link into whatever panel owns that record; a milestone lives in this tab's own "План". */
function ActivityList({ items, onPlan }: { items: ProjectActivity[]; onPlan?: () => void }): React.ReactElement {
  if (items.length === 0) {
    return <p className="text-label text-subtle-foreground">Связанных задач, заметок и операций пока нет.</p>;
  }

  function open(item: ProjectActivity): void {
    if (item.type === "task") focusTask(item.id);
    else if (item.type === "note") focusNote(item.id);
    else if (item.type === "event") focusEvent(item.id);
    else if (item.type === "document") focusDocument(item.id);
    else if (item.type === "transaction") focusTransaction(item.id);
    else if (item.type === "inventory") openPanel("inventory");
    else if (item.type === "milestone") onPlan?.();
  }

  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        const Icon = ACTIVITY_ICON[item.type];
        const statusLabel = activityStatusLabel(item);
        return (
          <li key={`${item.type}:${item.id}`}>
            <button
              type="button"
              onClick={() => open(item)}
              title={ACTIVITY_LABEL[item.type]}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-row text-left transition-colors hover:bg-card-hover"
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-label text-foreground">{item.title}</span>
              {statusLabel ? <Badge>{statusLabel}</Badge> : null}
              <span className="shrink-0 text-micro text-subtle-foreground">{relativeTime(item.at)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Деньги и время (карточка обзора)
// ---------------------------------------------------------------------------

/**
 * Money and time as one card on the overview, each half shown only when its module is on.
 * An unset budget or estimate says what to do about it instead of printing «не задан».
 */
function MoneyTimeCard({
  project,
  financeOn,
  timeOn,
  tasksOn,
  onEdit
}: {
  project: ProjectDetail;
  financeOn: boolean;
  timeOn: boolean;
  tasksOn: boolean;
  onEdit: () => void;
}): React.ReactElement | null {
  if (!financeOn && !timeOn) return null;
  const budget = project.budgetAmount;
  const overspent = budget !== null && budget > 0 && project.spentAmount > budget;
  const budgetPercent = budget && budget > 0 ? Math.min(100, Math.round((project.spentAmount / budget) * 100)) : null;
  const planned = tasksOn ? project.plannedMinutes : null;
  const timePercent = planned && planned > 0 ? Math.min(100, Math.round((project.trackedMinutes / planned) * 100)) : null;
  const overtime = planned !== null && planned > 0 && project.trackedMinutes > planned;

  return (
    <Card className="space-y-4 px-4 py-3">
      {financeOn ? (
        <div className="space-y-1.5">
          <SideTitle>Деньги</SideTitle>
          {budgetPercent !== null && budget !== null ? (
            <>
              <Meter value={budgetPercent} tone={overspent ? "danger" : "accent"} />
              <p className={cx("font-mono text-label tabular-nums", overspent ? "text-destructive" : "text-foreground")}>
                {formatMoney(project.spentAmount, project.currency)} из {formatMoney(budget, project.currency)}
                {overspent ? " · перерасход" : ""}
              </p>
            </>
          ) : (
            <p className="text-label text-foreground">
              <span className="font-mono tabular-nums">{formatMoney(project.spentAmount, project.currency)}</span> потрачено{" "}
              <button type="button" onClick={onEdit} className="text-accent-text hover:underline">
                Задать бюджет
              </button>
            </p>
          )}
          <button type="button" onClick={() => openPanel("finance")} className="inline-flex items-center gap-1 text-micro text-subtle-foreground hover:text-foreground">
            <Receipt className="h-3 w-3" aria-hidden /> Операции в финансах
          </button>
        </div>
      ) : null}

      {timeOn ? (
        <div className="space-y-1.5">
          <SideTitle>Время</SideTitle>
          {timePercent !== null && planned !== null ? <Meter value={timePercent} tone={overtime ? "danger" : "accent"} /> : null}
          <p className={cx("font-mono text-label tabular-nums", overtime ? "text-destructive" : "text-foreground")}>
            {project.trackedMinutes === 0 ? "Пока не учтено" : formatDuration(project.trackedMinutes)}
            {planned !== null ? ` из плана ${formatDuration(planned)}` : ""}
            {overtime ? " · больше плана" : ""}
          </p>
          {project.trackedMinutes > 0 ? <p className="text-micro text-subtle-foreground">Стоимость времени: {timeCostLabel(project)}</p> : null}
          <button type="button" onClick={() => openPanel("time")} className="inline-flex items-center gap-1 text-micro text-subtle-foreground hover:text-foreground">
            <Timer className="h-3 w-3" aria-hidden /> Открыть учёт времени
          </button>
        </div>
      ) : null}
    </Card>
  );
}

function timeCostLabel(project: ProjectDetail): string {
  if (project.trackedMinutes === 0) return "—";
  if (project.timeCost !== null) {
    const priced = formatMoney(project.timeCost, project.currency);
    if (project.unratedMinutes > 0) {
      return `${priced} · оценено ${formatDuration(project.trackedMinutes - project.unratedMinutes)} из ${formatDuration(project.trackedMinutes)}`;
    }
    return priced;
  }
  return "ставка не задана";
}

function schedulePercent(startAt: string | null, dueAt: string | null, now = Date.now()): number | null {
  if (!startAt || !dueAt) return null;
  const start = Date.parse(startAt);
  const due = Date.parse(dueAt);
  if (!Number.isFinite(start) || !Number.isFinite(due) || due <= start) return null;
  return Math.min(100, Math.max(0, Math.round(((now - start) / (due - start)) * 100)));
}

/** Whole local days from today to `iso` (negative = in the past). */
function daysUntil(iso: string, now = new Date()): number {
  const due = new Date(iso);
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const b = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "день" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "дня" : "дней";
  return `${n} ${word}`;
}

function QuickNoteForm({
  busy,
  onSubmit,
  onCancel
}: {
  busy: boolean;
  onSubmit: (title: string, body: string) => void | Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!title.trim()) return;
    void onSubmit(title.trim(), body);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input placeholder="Заголовок" value={title} onChange={(event) => setTitle(event.target.value)} required autoFocus />
      <Textarea
        placeholder="Текст (необязательно)"
        rows={5}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy || !title.trim()}>
          Создать
        </Button>
      </div>
    </form>
  );
}

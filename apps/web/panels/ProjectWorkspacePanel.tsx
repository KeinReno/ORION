"use client";

import {
  useArchiveProject,
  useCreateNote,
  useCreateTask,
  useDocuments,
  useMilestones,
  useNotes,
  useProject,
  useProjects,
  useTasks,
  useUpdateProject,
  useUpdateTask
} from "@orion/core-react";
import {
  formatDuration,
  isProjectOverdue,
  isTaskClosed,
  type ProjectActivity,
  type ProjectDetail,
  type Task,
  type TaskStatus
} from "@orion/shared-types";
import {
  Badge,
  Button,
  Card,
  CheckToggle,
  ConfirmDialog,
  ContextNoteField,
  EmptyState,
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
  FolderOpen,
  ListTodo,
  Milestone as MilestoneIcon,
  Package,
  Pencil,
  Plus,
  Receipt,
  TriangleAlert
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EntityLinksSection } from "../components/entity-links";
import { ShareGrantSection } from "../components/share-grant-section";
import { describeError } from "../lib/error-message";
import { formatMoney, relativeTime, shortDate, shortDateTime } from "../lib/format";
import { focusDocument, focusNote, focusTask, focusTransaction, focusEvent, openPanel, showTasksForProject } from "../lib/panel-bus";
import type { PanelComponentProps } from "../lib/panel-registry";
import { groupTasksByMilestone, isTaskOverdue, projectFocus } from "../lib/project-focus";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { PROJECT_STATUS_LABEL, ProjectForm, projectSwatchColor, type ProjectFormValues } from "./project-form";
import { Meter, STATUS_TONE, taskProgressLabel } from "./projects/project-bits";
import { ProjectGantt } from "./projects/gantt";
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, TaskForm, type TaskFormValues } from "./task-form";

type ProjectTab = "overview" | "tasks" | "plan" | "materials" | "money" | "access";

const PROJECT_TABS: readonly ProjectTab[] = ["overview", "tasks", "plan", "materials", "money", "access"];
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
 * plan, materials and money each get the full panel width in their own tab.
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

  const tasks = useMemo(() => (allTasks ?? []).filter((task) => task.projectId === project.id), [allTasks, project.id]);
  const milestoneList = useMemo(() => milestones ?? [], [milestones]);
  const focus = useMemo(() => projectFocus(tasks, milestoneList), [tasks, milestoneList]);

  const projectOptions = useMemo(() => {
    const list = workspaceProjects ?? [];
    return list.some((item) => item.id === project.id) ? list : [project, ...list];
  }, [workspaceProjects, project]);

  const showMoney = financeOn || timeOn || project.startAt !== null || project.dueAt !== null;
  const tabs: { value: ProjectTab; label: React.ReactNode }[] = [
    { value: "overview", label: "Обзор" },
    ...(tasksOn ? [{ value: "tasks" as const, label: `Задачи${focus.open > 0 ? ` · ${focus.open}` : ""}` }] : []),
    ...(tasksOn ? [{ value: "plan" as const, label: "План" }] : []),
    { value: "materials", label: "Материалы" },
    ...(showMoney ? [{ value: "money" as const, label: "Сроки и деньги" }] : []),
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
  const overdue = isProjectOverdue(project);

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
            {project.archivedAt ? <Badge>В архиве</Badge> : null}
            <Badge tone={STATUS_TONE[project.status]}>{PROJECT_STATUS_LABEL[project.status]}</Badge>
            {overdue ? <Badge tone="danger">Просрочен</Badge> : null}
            {tasksOn ? (
              <Button size="sm" onClick={() => setAdding("task")}>
                <Plus className="h-4 w-4" /> Задача
              </Button>
            ) : null}
            {notesOn ? (
              <Button size="sm" variant="subtle" onClick={() => setAdding("note")}>
                <Plus className="h-4 w-4" /> Заметка
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> Изменить
            </Button>
          </>
        }
      >
        <SegmentedControl<ProjectTab> value={tab} onChange={setTab} size="sm" options={tabs} />
      </PanelHeader>

      <PanelBody className="[container-type:inline-size]">
        {tab === "overview" ? (
          <OverviewTab
            workspaceId={workspaceId}
            project={project}
            focus={focus}
            tasksOn={tasksOn}
            tasksLoading={tasksOn && tasksLoading}
            timeOn={timeOn}
            financeOn={financeOn}
            busyNote={updateProject.isPending}
            onSaveNote={(contextNote) => updateProject.mutate({ projectId: project.id, input: { contextNote } })}
            onToggle={toggleTask}
            onGoTo={setTab}
            onAddTask={() => setAdding("task")}
          />
        ) : null}

        {tab === "tasks" ? (
          <TasksTab
            tasks={tasks}
            milestones={milestoneList}
            loading={tasksLoading}
            onToggle={toggleTask}
            onAddTask={() => setAdding("task")}
            onOpenBoard={() => showTasksForProject(project.id)}
          />
        ) : null}

        {tab === "plan" ? <ProjectGantt projectId={project.id} /> : null}

        {tab === "materials" ? (
          <MaterialsTab workspaceId={workspaceId} project={project} notesOn={notesOn} documentsOn={documentsOn} onAddNote={() => setAdding("note")} />
        ) : null}

        {tab === "money" ? <MoneyTab project={project} financeOn={financeOn} timeOn={timeOn} tasksOn={tasksOn} /> : null}

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
  tasksOn,
  tasksLoading,
  timeOn,
  financeOn,
  busyNote,
  onSaveNote,
  onToggle,
  onGoTo,
  onAddTask
}: {
  workspaceId: string | undefined;
  project: ProjectDetail;
  focus: ReturnType<typeof projectFocus>;
  tasksOn: boolean;
  tasksLoading: boolean;
  timeOn: boolean;
  financeOn: boolean;
  busyNote: boolean;
  onSaveNote: (value: string) => void;
  onToggle: (task: Task) => void;
  onGoTo: (tab: ProjectTab) => void;
  onAddTask: () => void;
}): React.ReactElement {
  const progress = Math.min(100, Math.max(0, project.progress));
  const now = new Date();
  const fire = [...focus.overdue, ...focus.blocked];

  return (
    <div className="grid grid-cols-1 gap-6 [@container(min-width:1152px)]:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <ContextNoteField value={project.contextNote} busy={busyNote} onSave={onSaveNote} />

        {tasksOn ? (
          <PanelSection
            title="Дальше"
            actions={
              focus.open > focus.next.length + focus.blocked.length ? (
                <Button size="sm" variant="ghost" onClick={() => onGoTo("tasks")}>
                  Все открытые · {focus.open}
                </Button>
              ) : null
            }
          >
            {tasksLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : focus.next.length === 0 ? (
              <EmptyState
                icon={ListTodo}
                title={focus.open === 0 ? "Открытых задач нет" : "Всё открытое ждёт зависимостей"}
                description={
                  focus.open === 0
                    ? "Добавьте следующий шаг — он появится здесь первым."
                    : "Закройте блокирующие задачи — остальное разблокируется."
                }
                action={
                  <Button size="sm" onClick={onAddTask}>
                    <Plus className="h-4 w-4" /> Задача
                  </Button>
                }
              />
            ) : (
              <ul className="flex flex-col">
                {focus.next.map((task) => (
                  <TaskRow key={task.id} task={task} now={now} onToggle={() => onToggle(task)} />
                ))}
              </ul>
            )}
          </PanelSection>
        ) : null}

        {tasksOn && fire.length > 0 ? (
          <PanelSection title={`Горит · ${fire.length}`}>
            <Card className="border-destructive/30 px-2 py-1">
              <ul className="flex flex-col">
                {fire.map((task) => (
                  <TaskRow key={task.id} task={task} now={now} onToggle={() => onToggle(task)} />
                ))}
              </ul>
            </Card>
          </PanelSection>
        ) : null}

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

        {tasksOn ? (
          <Card className="space-y-2 px-4 py-3">
            <SideTitle>Ближайшая веха</SideTitle>
            {focus.nextMilestone ? (
              <button type="button" onClick={() => onGoTo("plan")} className="block w-full text-left">
                <p className="truncate text-label text-foreground">{focus.nextMilestone.milestone.title}</p>
                <p className="mt-0.5 text-micro text-subtle-foreground">
                  {focus.nextMilestone.milestone.dueAt ? `до ${shortDate(focus.nextMilestone.milestone.dueAt)} · ` : ""}
                  {focus.nextMilestone.total === 0
                    ? "задач пока нет"
                    : `осталось ${focus.nextMilestone.open} из ${focus.nextMilestone.total}`}
                </p>
                {focus.nextMilestone.total > 0 ? (
                  <div className="mt-2">
                    <Meter
                      value={Math.round(
                        ((focus.nextMilestone.total - focus.nextMilestone.open) / focus.nextMilestone.total) * 100
                      )}
                    />
                  </div>
                ) : null}
              </button>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className="text-label text-subtle-foreground">Вех нет</p>
                <Button size="sm" variant="ghost" onClick={() => onGoTo("plan")}>
                  <Plus className="h-4 w-4" /> Веха
                </Button>
              </div>
            )}
          </Card>
        ) : null}

        <DeadlineCard project={project} />

        <Card className="px-4 py-3">
          <SideTitle>Состав</SideTitle>
          <dl className="mt-2 flex flex-col">
            <CompositionRow label="Заметки" value={String(project.counts.notes)} onClick={() => onGoTo("materials")} />
            <CompositionRow label="Файлы" value={String(project.counts.documents)} onClick={() => onGoTo("materials")} />
            <CompositionRow label="События" value={String(project.counts.events)} onClick={() => onGoTo("materials")} />
            {project.counts.inventory > 0 ? (
              <CompositionRow label="Склад" value={String(project.counts.inventory)} onClick={() => openPanel("inventory")} />
            ) : null}
            {timeOn ? (
              <CompositionRow label="Время" value={formatDuration(project.trackedMinutes)} onClick={() => onGoTo("money")} />
            ) : null}
            {financeOn ? (
              <CompositionRow
                label="Потрачено"
                value={
                  project.budgetAmount !== null
                    ? `${formatMoney(project.spentAmount, project.currency)} / ${formatMoney(project.budgetAmount, project.currency)}`
                    : formatMoney(project.spentAmount, project.currency)
                }
                danger={project.budgetAmount !== null && project.spentAmount > project.budgetAmount}
                onClick={() => onGoTo("money")}
              />
            ) : null}
          </dl>
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
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-card-hover"
    >
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className={cx("font-mono text-label tabular-nums", danger ? "text-destructive" : "text-foreground")}>{value}</dd>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Задачи
// ---------------------------------------------------------------------------

function TasksTab({
  tasks,
  milestones,
  loading,
  onToggle,
  onAddTask,
  onOpenBoard
}: {
  tasks: Task[];
  milestones: Parameters<typeof groupTasksByMilestone>[1];
  loading: boolean;
  onToggle: (task: Task) => void;
  onAddTask: () => void;
  onOpenBoard: () => void;
}): React.ReactElement {
  const [showClosed, setShowClosed] = useState(false);
  const groups = useMemo(() => groupTasksByMilestone(tasks, milestones, showClosed), [tasks, milestones, showClosed]);
  const now = new Date();

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
    <div className="flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl<"open" | "all">
          value={showClosed ? "all" : "open"}
          onChange={(value) => setShowClosed(value === "all")}
          size="sm"
          options={[
            { value: "open", label: "Открытые" },
            { value: "all", label: "Все" }
          ]}
        />
        <Button size="sm" variant="outline" onClick={onOpenBoard}>
          <ListTodo className="h-4 w-4" /> На доске задач
        </Button>
      </div>
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
              <p className="px-2 text-label text-subtle-foreground">
                {total === 0 ? "Задач у вехи пока нет." : "Всё закрыто."}
              </p>
            ) : (
              <ul className="flex flex-col">
                {group.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} now={now} onToggle={() => onToggle(task)} />
                ))}
              </ul>
            )}
          </PanelSection>
        );
      })}
    </div>
  );
}

function TaskRow({ task, now, onToggle }: { task: Task; now: Date; onToggle: () => void }): React.ReactElement {
  const closed = isTaskClosed(task.status);
  const overdue = isTaskOverdue(task, now);
  return (
    <li className="flex items-center gap-2 rounded-lg px-2 py-row transition-colors hover:bg-card-hover">
      <CheckToggle
        checked={task.status === "done"}
        onClick={onToggle}
        label={task.status === "done" ? "Вернуть в работу" : "Отметить выполненной"}
        disabled={task.status === "canceled"}
        size="sm"
      />
      <button
        type="button"
        onClick={() => focusTask(task.id)}
        title="Открыть задачу"
        className={cx(
          "min-w-0 flex-1 truncate text-left text-label",
          closed ? "text-subtle-foreground line-through" : "text-foreground hover:underline"
        )}
      >
        {task.title}
      </button>
      {task.status === "in_progress" || task.status === "backlog" || task.status === "canceled" ? (
        <Badge tone={task.status === "in_progress" ? "accent" : "neutral"}>{TASK_STATUS_LABEL[task.status]}</Badge>
      ) : null}
      {!closed && task.blocked ? <Badge tone="warning">Ждёт зависимость</Badge> : null}
      {!closed && task.priority === "high" ? <Badge tone="warning" icon={false}>{TASK_PRIORITY_LABEL.high}</Badge> : null}
      {task.dueAt ? (
        <span className={cx("shrink-0 font-mono text-micro tabular-nums", overdue ? "text-destructive" : "text-subtle-foreground")}>
          {shortDate(task.dueAt)}
        </span>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Материалы
// ---------------------------------------------------------------------------

function MaterialsTab({
  workspaceId,
  project,
  notesOn,
  documentsOn,
  onAddNote
}: {
  workspaceId: string | undefined;
  project: ProjectDetail;
  notesOn: boolean;
  documentsOn: boolean;
  onAddNote: () => void;
}): React.ReactElement {
  const { data: notes, isLoading: notesLoading } = useNotes(notesOn ? workspaceId : undefined);
  const { data: documents, isLoading: documentsLoading } = useDocuments(documentsOn ? workspaceId : undefined);
  const projectNotes = useMemo(
    () =>
      (notes ?? [])
        .filter((note) => note.projectId === project.id)
        .sort((a, b) => (b.editedAt ?? b.updatedAt).localeCompare(a.editedAt ?? a.updatedAt)),
    [notes, project.id]
  );
  const projectFiles = useMemo(
    () => (documents ?? []).filter((doc) => doc.projectId === project.id && doc.kind === "file" && !doc.deletedAt),
    [documents, project.id]
  );
  // Events, operations and stock have no cheap per-project list on the client;
  // the project's own activity feed already carries them.
  const other = project.activity.filter((item) => item.type === "event" || item.type === "transaction" || item.type === "inventory");

  return (
    <div className="grid grid-cols-1 gap-6 [@container(min-width:896px)]:grid-cols-2">
      {notesOn ? (
        <PanelSection
          title={`Заметки · ${projectNotes.length}`}
          actions={
            <Button size="sm" variant="ghost" onClick={onAddNote}>
              <Plus className="h-4 w-4" /> Заметка
            </Button>
          }
        >
          {notesLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : projectNotes.length === 0 ? (
            <p className="text-label text-subtle-foreground">Заметок, привязанных к проекту, нет.</p>
          ) : (
            <ul className="flex flex-col">
              {projectNotes.map((note) => (
                <MaterialRow
                  key={note.id}
                  icon={FileText}
                  title={note.title || "Без заголовка"}
                  meta={relativeTime(note.editedAt ?? note.updatedAt)}
                  onClick={() => focusNote(note.id)}
                />
              ))}
            </ul>
          )}
        </PanelSection>
      ) : null}

      {documentsOn ? (
        <PanelSection title={`Файлы · ${projectFiles.length}`}>
          {documentsLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : projectFiles.length === 0 ? (
            <p className="text-label text-subtle-foreground">Файлов, привязанных к проекту, нет.</p>
          ) : (
            <ul className="flex flex-col">
              {projectFiles.map((doc) => (
                <MaterialRow
                  key={doc.id}
                  icon={FolderOpen}
                  title={doc.name}
                  meta={relativeTime(doc.updatedAt)}
                  onClick={() => focusDocument(doc.id)}
                />
              ))}
            </ul>
          )}
        </PanelSection>
      ) : null}

      {other.length > 0 ? (
        <PanelSection title="События, операции, склад">
          <ActivityList items={other} />
        </PanelSection>
      ) : null}

      <PanelSection title="Связи">
        <EntityLinksSection workspaceId={workspaceId} type="project" id={project.id} />
      </PanelSection>
    </div>
  );
}

function MaterialRow({
  icon: Icon,
  title,
  meta,
  onClick
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  meta: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-row text-left transition-colors hover:bg-card-hover"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-label text-foreground">{title}</span>
        <span className="shrink-0 text-micro text-subtle-foreground">{meta}</span>
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
// Сроки и деньги
// ---------------------------------------------------------------------------

function MoneyTab({
  project,
  financeOn,
  timeOn,
  tasksOn
}: {
  project: ProjectDetail;
  financeOn: boolean;
  timeOn: boolean;
  tasksOn: boolean;
}): React.ReactElement {
  const overdue = isProjectOverdue(project);
  const overspent = financeOn && project.budgetAmount !== null && project.spentAmount > project.budgetAmount;
  const schedule = schedulePercent(project.startAt, project.dueAt);
  const budgetPercent =
    project.budgetAmount && project.budgetAmount > 0
      ? Math.min(100, Math.round((project.spentAmount / project.budgetAmount) * 100))
      : null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PanelSection title="Сроки">
        {schedule !== null ? (
          <div>
            <Meter value={schedule} tone={overdue ? "danger" : "accent"} />
            <p className="mt-1 text-micro text-subtle-foreground">
              {overdue ? "Срок уже прошёл" : `Прошло ${schedule}% окна проекта`}
            </p>
          </div>
        ) : null}
        <dl className="grid gap-3 text-label [@container(min-width:576px)]:grid-cols-3">
          <Field label="Начало" value={project.startAt ? shortDateTime(project.startAt) : "—"} />
          <Field label="Срок" value={project.dueAt ? shortDateTime(project.dueAt) : "—"} tone={overdue ? "danger" : undefined} />
          {tasksOn ? (
            <Field
              label="План, часы"
              value={project.plannedMinutes !== null ? formatDuration(project.plannedMinutes) : "не оценено"}
            />
          ) : null}
        </dl>
      </PanelSection>

      {financeOn ? (
        <PanelSection title="Деньги">
          {budgetPercent !== null ? (
            <div>
              <Meter value={budgetPercent} tone={overspent ? "danger" : "accent"} />
              <p className={cx("mt-1 font-mono text-micro tabular-nums", overspent ? "text-destructive" : "text-subtle-foreground")}>
                {formatMoney(project.spentAmount, project.currency)} из {formatMoney(project.budgetAmount as number, project.currency)}
                {overspent ? " · перерасход" : ""}
              </p>
            </div>
          ) : null}
          <dl className="grid gap-3 text-label [@container(min-width:576px)]:grid-cols-3">
            <Field
              label="Бюджет"
              value={project.budgetAmount !== null ? formatMoney(project.budgetAmount, project.currency) : "не задан"}
            />
            <Field label="Потрачено" value={formatMoney(project.spentAmount, project.currency)} tone={overspent ? "danger" : undefined} />
          </dl>
          <Button size="sm" variant="outline" onClick={() => openPanel("finance")}>
            <Receipt className="h-4 w-4" /> Операции в финансах
          </Button>
        </PanelSection>
      ) : null}

      {timeOn ? (
        <PanelSection title="Время">
          <dl className="grid gap-3 text-label [@container(min-width:576px)]:grid-cols-3">
            <Field label="Учтено" value={formatDuration(project.trackedMinutes)} />
            <Field label="Стоимость времени" value={timeCostLabel(project)} />
          </dl>
        </PanelSection>
      ) : null}
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "danger" }): React.ReactElement {
  return (
    <div>
      <dt className="text-2xs text-subtle-foreground">{label}</dt>
      <dd className={tone === "danger" ? "text-destructive" : "text-foreground"}>{value}</dd>
    </div>
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

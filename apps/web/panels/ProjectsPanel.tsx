"use client";

import { dragEndWindowTarget } from "../lib/panel-drag";
import { ORION_PANEL_DRAG_MIME } from "../lib/panel-drop";
import { detachPanelToWindow } from "../lib/panel-window";
import { applyProjectOrder, moveProject, projectOrderKey, stepProject } from "../lib/project-order";
import { useCreateProject, useProjects, useReorderProjects, useSession, useTasks } from "@orion/core-react";
import { compareProjectsBySharedOrder, formatDuration, PROJECT_STATUS_ORDER, type Project, type ProjectStatus } from "@orion/shared-types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PanelBody,
  PanelHeader,
  PanelShell,
  SegmentedControl,
  Select,
  Skeleton,
  cx,
  useToast
} from "@orion/ui";
import { FolderKanban, Plus, Search, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useViewState } from "../lib/use-view-state";
import { projectsViewStateSchema } from "@orion/shared-types";
import { describeError } from "../lib/error-message";
import { formatMoney } from "../lib/format";
import { openProject } from "../lib/panel-bus";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { PROJECT_STATUS_LABEL, ProjectForm, projectSwatchColor, type ProjectFormValues } from "./project-form";
import { FilterChip } from "../components/filter-chip";
import {
  PROJECT_BOARD_SORT_LABEL,
  summariseProjectBoard,
  visibleProjectBoard,
  type ProjectBoardSort,
  type ProjectBoardSummary
} from "./projects/board";
import { ReportedHealthBadge, STATUS_TONE, taskProgressLabel } from "../components/project-bits";
import { ProjectListHeader, ProjectRow } from "./projects/project-row";
import { DueChip, NextLine } from "./projects/project-vitals";
import { nextActionByProject, pluralDays, reportFreshness, type ProjectNextAction } from "../lib/project-status";

/**
 * «Проекты» (v0.14) — a project is what a task's free-form `projectTag` grew
 * into: a real row that tasks, notes, events, documents and finance
 * transactions can all point at. This panel is the board of those rows; a
 * project itself opens as its own dock tab (`ProjectWorkspacePanel`, via
 * `openProject`) — it used to be a 40rem Sheet over this board, which showed
 * counters instead of the work.
 */
type BoardLayout = "list" | "cards";
const LAYOUT_KEY = "orion.projects.layout";

function loadLayout(): BoardLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "cards" ? "cards" : "list";
  } catch {
    return "list";
  }
}

export function ProjectsPanel(): React.ReactElement {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const [archived, setArchived] = useState(false);
  const { data: projects, isLoading, isError, error, refetch } = useProjects(workspaceId, archived);
  const createProject = useCreateProject(workspaceId);
  const reorderProjects = useReorderProjects(workspaceId);
  // «Порядок команды»: общий порядок пространства; менять его могут владелец и лид, остальные только видят.
  const canEditShared = workspace?.role === "owner" || workspace?.role === "lead";
  const { isEnabled } = useEnabledModules();
  // One workspace task list feeds "Дальше" on every card — no per-project requests.
  const { data: allTasks } = useTasks(isEnabled("tasks") ? workspaceId : undefined);
  const nextActions = useMemo(() => nextActionByProject(allTasks ?? []), [allTasks]);
  const { toast } = useToast();

  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | null>(null);
  const [sort, setSort] = useState<ProjectBoardSort>("lifecycle");
  const [layout, setLayout] = useState<BoardLayout>("list");
  // Read after mount: the first paint must match the server-rendered markup.
  useEffect(() => setLayout(loadLayout()), []);
  function chooseLayout(next: BoardLayout): void {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      /* a remembered layout is a convenience only */
    }
  }

  const source = useMemo(() => projects ?? [], [projects]);
  const summary = useMemo(() => summariseProjectBoard(source), [source]);
  // "Мой порядок": the viewer's own drag order, kept in localStorage (never shared).
  const { user } = useSession();
  const orderKey = user && workspaceId ? projectOrderKey(user.id, workspaceId) : null;
  useViewState("projects", projectsViewStateSchema, workspaceId, { archived, statusFilter, sort, layout },
    (saved) => { setArchived(saved.archived); setStatusFilter(saved.statusFilter); setSort(saved.sort); setLayout(saved.layout); });
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = orderKey ? localStorage.getItem(orderKey) : null;
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      setManualOrder(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
    } catch {
      setManualOrder([]);
    }
  }, [orderKey]);
  const list = useMemo(() => {
    const visible = visibleProjectBoard(source, query, statusFilter, sort);
    return sort === "manual" ? applyProjectOrder(visible, manualOrder) : visible;
  }, [source, query, statusFilter, sort, manualOrder]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** What the drag in flight will do at its end: an OS window (Ctrl, or dock drop outside the app) or nothing. */
  const dragModeRef = useRef<"dock" | "window" | null>(null);
  function commitOrder(next: string[]): void {
    if (sort === "shared") {
      reorderProjects.mutate(
        { ids: next },
        { onError: () => toast({ title: "Не удалось сохранить порядок команды", tone: "danger" }) }
      );
      return;
    }
    setManualOrder(next);
    try {
      if (orderKey) localStorage.setItem(orderKey, JSON.stringify(next));
    } catch {
      /* a remembered order is a convenience only */
    }
  }
  /** Drag + Alt+↑/↓ handlers for one list item; only active in "Мой порядок". */
  function itemProps(project: Project): React.HTMLAttributes<HTMLLIElement> | undefined {
    const ids = list.map((p) => p.id);
    const shared = sort === "shared";
    const manual = sort === "manual" || (shared && canEditShared);
    // Полный порядок: в «Порядке команды» берётся серверный, в «Моём» — локальный.
    const full = shared ? [...source].sort(compareProjectsBySharedOrder).map((p) => p.id) : manualOrder.length ? manualOrder : ids;
    return {
      draggable: true,
      onDragStart: (event) => {
        // Ctrl+drag takes the project OUT as an OS window; a plain drag opens it as a panel inside the app
        // (an OS window if dropped outside the app window) — except in a manual order, where a plain
        // drag reorders the list instead.
        if (event.ctrlKey || event.metaKey) {
          dragModeRef.current = "window";
          event.dataTransfer.effectAllowed = "none";
          event.dataTransfer.setData("text/plain", project.id);
          return;
        }
        if (!manual) {
          dragModeRef.current = "dock";
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData(ORION_PANEL_DRAG_MIME, `project:${project.id}`);
          return;
        }
        dragModeRef.current = null;
        setDraggingId(project.id);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", project.id);
      },
      onDragEnd: (event) => {
        setDraggingId(null);
        const mode = dragModeRef.current;
        dragModeRef.current = null;
        if (!mode) return;
        const at = dragEndWindowTarget({
          mode,
          dropEffect: event.dataTransfer.dropEffect,
          clientX: event.clientX,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight
        });
        if (at) void detachPanelToWindow(`project:${project.id}`, project.name, at);
      },
      onDragOver: (event) => {
        if (draggingId) event.preventDefault();
      },
      onDrop: (event) => {
        event.preventDefault();
        if (draggingId) commitOrder(moveProject(full, ids, draggingId, project.id));
        setDraggingId(null);
      },
      onKeyDown: (event) => {
        if (!manual || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
        commitOrder(stepProject(full, ids, project.id, event.key === "ArrowUp" ? -1 : 1));
      },
      title: manual
        ? "Перетащите, чтобы изменить порядок (Alt+↑/↓); Ctrl+перетаскивание — открыть отдельным окном"
        : "Перетащите в рабочую область — откроется панелью (за пределами окна — отдельным окном); Ctrl+перетаскивание — отдельным окном"
    };
  }
  const filteredOut = source.length > 0 && list.length === 0;
  // The workspace query resolves before the project list can even start, so
  // until it lands all the hooks above are intentionally idle — show the
  // skeleton rather than an empty board that "flickers" into place.
  const loading = workspaceLoading || !workspaceId || isLoading;

  async function create(values: ProjectFormValues): Promise<void> {
    try {
      await createProject.mutateAsync(values);
      setCreating(false);
      toast({ title: "Проект создан", tone: "success" });
    } catch {
      toast({ title: "Не удалось создать проект", tone: "danger" });
    }
  }

  return (
    <PanelShell>
      <PanelHeader
        icon={FolderKanban}
        title="Проекты"
        subtitle={
          projects
            ? query.trim() || statusFilter
              ? `${list.length} из ${source.length}`
              : `${source.length} шт.`
            : undefined
        }
        actions={
          <Button size="sm" onClick={() => setCreating(true)} disabled={!workspaceId}>
            <Plus className="h-4 w-4" /> Новый проект
          </Button>
        }
      >
        <div className="relative sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск проектов"
            className="pl-8"
          />
        </div>
        <Select
          value={sort}
          onChange={(event) => setSort(event.target.value as ProjectBoardSort)}
          className="sm:w-40"
          aria-label="Сортировка"
        >
          {(Object.keys(PROJECT_BOARD_SORT_LABEL) as ProjectBoardSort[]).map((value) => (
            <option key={value} value={value}>
              {PROJECT_BOARD_SORT_LABEL[value]}
            </option>
          ))}
        </Select>
        <SegmentedControl<BoardLayout>
          value={layout}
          onChange={chooseLayout}
          size="sm"
          aria-label="Вид списка"
          options={[
            { value: "list", label: "Список" },
            { value: "cards", label: "Карточки" }
          ]}
        />
        <SegmentedControl<"active" | "archive">
          value={archived ? "archive" : "active"}
          onChange={(value) => {
            setArchived(value === "archive");
          }}
          size="sm"
          options={[
            { value: "active", label: "Активные" },
            { value: "archive", label: "Архив" }
          ]}
        />
      </PanelHeader>

      <PanelBody className="[container-type:inline-size]">
        {loading ? (
          <div className="grid gap-3 [@container(min-width:576px)]:grid-cols-2 [@container(min-width:1152px)]:grid-cols-3 [@container(min-width:1408px)]:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={TriangleAlert}
            tone="danger"
            title="Не удалось загрузить проекты"
            description={describeError(error)}
            action={
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Повторить
              </Button>
            }
          />
        ) : source.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="Проектов пока нет"
            description={
              archived
                ? "В архиве пусто — проекты попадают сюда после архивации, связи с задачами и заметками сохраняются."
                : "Заведите проект, чтобы связать с ним задачи, заметки, события и операции."
            }
            action={
              archived ? undefined : (
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> Новый проект
                </Button>
              )
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            <ProjectRollup summary={summary} />
            <div className="flex flex-wrap items-center gap-1">
              <FilterChip active={statusFilter === null} onClick={() => setStatusFilter(null)}>
                Все
              </FilterChip>
              {PROJECT_STATUS_ORDER.map((status) => (
                <FilterChip key={status} active={statusFilter === status} onClick={() => setStatusFilter(status)}>
                  {PROJECT_STATUS_LABEL[status]}
                  {summary.byStatus[status] > 0 ? ` · ${summary.byStatus[status]}` : ""}
                </FilterChip>
              ))}
            </div>
            {filteredOut ? (
              <EmptyState
                icon={FolderKanban}
                title="Ничего не найдено"
                description="Сбросьте поиск или фильтр по статусу — в этом списке проекты есть."
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setQuery("");
                      setStatusFilter(null);
                    }}
                  >
                    Сбросить фильтры
                  </Button>
                }
              />
            ) : (
              layout === "list" ? (
                <div className="rounded-xl border border-border bg-card/40 py-2">
                  <ProjectListHeader />
                  <ul className="flex flex-col divide-y divide-border/60">
                    {list.map((project) => (
                      <ProjectRow
                        key={project.id}
                        project={project}
                        nextAction={nextActions.get(project.id)}
                        tasksOn={isEnabled("tasks")}
                        onOpen={() => openProject(project.id, project.name)}
                        itemProps={itemProps(project)}
                      />
                    ))}
                  </ul>
                </div>
              ) : (
              <div className="grid gap-3 [@container(min-width:576px)]:grid-cols-2 [@container(min-width:1152px)]:grid-cols-3 [@container(min-width:1408px)]:grid-cols-4">
                {list.map((project) => (
                  <div key={project.id} {...(itemProps(project) as React.HTMLAttributes<HTMLDivElement> | undefined)}>
                    <ProjectCard
                      project={project}
                      nextAction={nextActions.get(project.id)}
                      onOpen={() => openProject(project.id, project.name)}
                    />
                  </div>
                ))}
              </div>
              )
            )}
          </div>
        )}
      </PanelBody>

      <Modal open={creating} onClose={() => setCreating(false)} title="Новый проект" size="md">
        <ProjectForm
          busy={createProject.isPending}
          submitLabel="Создать"
          onSubmit={create}
          onCancel={() => setCreating(false)}
        />
      </Modal>

    </PanelShell>
  );
}

function ProjectCard({
  project,
  nextAction,
  onOpen
}: {
  project: Project;
  nextAction: ProjectNextAction | undefined;
  onOpen: () => void;
}): React.ReactElement {
  const { isEnabled } = useEnabledModules();
  const tasksOn = isEnabled("tasks");
  const timeOn = isEnabled("time");
  const financeOn = isEnabled("finance");
  const swatch = projectSwatchColor(project.color);
  const progress = Math.min(100, Math.max(0, project.progress));
  const overspent = financeOn && project.budgetAmount !== null && project.spentAmount > project.budgetAmount;
  const freshness = reportFreshness(project);
  const live = project.status === "active" && !project.archivedAt;

  // One mono line, only the modules that are actually on — not five equal chips.
  const meta: string[] = [];
  if (timeOn && project.trackedMinutes > 0) meta.push(formatDuration(project.trackedMinutes));
  if (financeOn) {
    meta.push(
      project.budgetAmount !== null
        ? `${formatMoney(project.spentAmount, project.currency)} / ${formatMoney(project.budgetAmount, project.currency)}`
        : formatMoney(project.spentAmount, project.currency)
    );
  }

  return (
    <Card
      interactive
      elevate
      role="button"
      tabIndex={0}
      aria-label={`Открыть проект «${project.name}»`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cx("flex flex-col gap-3 overflow-hidden py-card-row", !live && "opacity-80")}
      style={swatch ? { borderLeftWidth: 3, borderLeftColor: swatch } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-title text-foreground">{project.name}</span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <ReportedHealthBadge project={project} />
          {project.status !== "active" ? <Badge tone={STATUS_TONE[project.status]}>{PROJECT_STATUS_LABEL[project.status]}</Badge> : null}
        </span>
      </div>

      {project.description ? (
        <p className="-mt-1.5 line-clamp-2 text-label text-muted-foreground">{project.description}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <DueChip project={project} />
        {nextAction && nextAction.overdue > 0 ? (
          <span className="inline-flex items-center gap-1 text-micro text-destructive">
            <TriangleAlert className="h-3 w-3" aria-hidden />
            просрочено задач: {nextAction.overdue}
          </span>
        ) : null}
      </div>

      {tasksOn ? (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%`, backgroundColor: swatch }}
            />
          </div>
          <p className="mt-1 text-micro text-subtle-foreground">{taskProgressLabel(project)}</p>
        </div>
      ) : null}

      {tasksOn && live ? (
        <p className="truncate text-label">
          <NextLine live={live} tasksCount={project.counts.tasks} nextAction={nextAction} />
        </p>
      ) : null}

      {meta.length > 0 || freshness.kind === "stale" ? (
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {meta.length > 0 ? (
            <p className={cx("font-mono text-label tabular-nums", overspent ? "text-destructive" : "text-muted-foreground")}>
              {meta.join(" · ")}
            </p>
          ) : (
            <span />
          )}
          {freshness.kind === "stale" ? (
            <span className="text-micro text-warning" title="Автор давно не обновлял состояние проекта">
              отчёту {pluralDays(freshness.daysOld)}
            </span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function ProjectRollup({ summary }: { summary: ProjectBoardSummary }): React.ReactElement {
  const { isEnabled } = useEnabledModules();
  const timeOn = isEnabled("time");
  const financeOn = isEnabled("finance");
  const money = financeOn ? summary.money.filter((bucket) => bucket.budget > 0 || bucket.spent > 0) : [];
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-border bg-white/[0.02] px-3 py-2.5">
      <RollupStat label="Проектов" value={String(summary.total)} />
      <RollupStat
        label="Просрочено"
        value={String(summary.overdue)}
        tone={summary.overdue > 0 ? "danger" : undefined}
      />
      {timeOn ? <RollupStat label="Учтено" value={formatDuration(summary.trackedMinutes)} /> : null}
      {timeOn && summary.unratedMinutes > 0 ? (
        <RollupStat label="Без ставки" value={formatDuration(summary.unratedMinutes)} />
      ) : null}
      {money.map((bucket) => {
        const suffix = summary.money.length > 1 ? ` · ${bucket.currency}` : "";
        return (
          <RollupStat
            key={bucket.currency}
            label={`${bucket.budget > 0 ? "Потрачено / бюджет" : "Потрачено"}${suffix}`}
            value={
              bucket.budget > 0
                ? `${formatMoney(bucket.spent, bucket.currency)} из ${formatMoney(bucket.budget, bucket.currency)}`
                : formatMoney(bucket.spent, bucket.currency)
            }
          />
        );
      })}
    </div>
  );
}

function RollupStat({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone?: "danger";
}): React.ReactElement {
  return (
    <div>
      <p className={`font-mono text-sm font-semibold tabular-nums ${tone === "danger" ? "text-destructive" : "text-foreground"}`}>
        {value}
      </p>
      <p className="text-2xs text-subtle-foreground">{label}</p>
    </div>
  );
}

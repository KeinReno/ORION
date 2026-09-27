"use client";

import { useCreateProject, useProjects } from "@orion/core-react";
import { formatDuration, isProjectOverdue, PROJECT_STATUS_ORDER, type Project, type ProjectStatus } from "@orion/shared-types";
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
import { useMemo, useState } from "react";
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
import { STATUS_TONE, taskProgressLabel } from "./projects/project-bits";

/**
 * «Проекты» (v0.14) — a project is what a task's free-form `projectTag` grew
 * into: a real row that tasks, notes, events, documents and finance
 * transactions can all point at. This panel is the board of those rows; a
 * project itself opens as its own dock tab (`ProjectWorkspacePanel`, via
 * `openProject`) — it used to be a 40rem Sheet over this board, which showed
 * counters instead of the work.
 */
export function ProjectsPanel(): React.ReactElement {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const [archived, setArchived] = useState(false);
  const { data: projects, isLoading, isError, error, refetch } = useProjects(workspaceId, archived);
  const createProject = useCreateProject(workspaceId);
  const { toast } = useToast();

  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | null>(null);
  const [sort, setSort] = useState<ProjectBoardSort>("lifecycle");

  const source = useMemo(() => projects ?? [], [projects]);
  const summary = useMemo(() => summariseProjectBoard(source), [source]);
  const list = useMemo(
    () => visibleProjectBoard(source, query, statusFilter, sort),
    [source, query, statusFilter, sort]
  );
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

      <PanelBody>
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {list.map((project) => (
                  <ProjectCard key={project.id} project={project} onOpen={() => openProject(project.id, project.name)} />
                ))}
              </div>
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

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }): React.ReactElement {
  const { isEnabled } = useEnabledModules();
  const tasksOn = isEnabled("tasks");
  const timeOn = isEnabled("time");
  const financeOn = isEnabled("finance");
  const swatch = projectSwatchColor(project.color);
  const progress = Math.min(100, Math.max(0, project.progress));
  const overdue = isProjectOverdue(project);
  const overspent = financeOn && project.budgetAmount !== null && project.spentAmount > project.budgetAmount;

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
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="flex flex-col gap-2 overflow-hidden py-card-row"
      style={swatch ? { borderLeftWidth: 3, borderLeftColor: swatch } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-title text-foreground">{project.name}</span>
        <Badge tone={STATUS_TONE[project.status]}>{PROJECT_STATUS_LABEL[project.status]}</Badge>
      </div>

      {overdue ? (
        <p className="inline-flex items-center gap-1 text-micro text-destructive">
          <TriangleAlert className="h-3 w-3" aria-hidden />
          Просрочен
        </p>
      ) : null}

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

      {meta.length > 0 ? (
        <p
          className={cx(
            "mt-auto font-mono text-label tabular-nums",
            overspent ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {meta.join(" · ")}
        </p>
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

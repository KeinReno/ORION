"use client";

import type { Project } from "@orion/shared-types";
import { Badge, cx } from "@orion/ui";
import { TriangleAlert } from "lucide-react";
import { pluralDays, reportFreshness, type ProjectNextAction } from "../../lib/project-status";
import { PROJECT_STATUS_LABEL, projectSwatchColor } from "../project-form";
import { Meter, ReportedHealthBadge, STATUS_TONE } from "../../components/project-bits";
import { DueChip, NextLine } from "./project-vitals";

/**
 * Column template shared by the header and every row, so they cannot drift.
 * Columns appear by the *list's own* width (container queries), because a
 * dock split makes a panel narrow inside a wide window: name always wins,
 * then the author's state, the deadline, and the progress bar last.
 */
export const PROJECT_ROW_GRID =
  "grid items-center gap-x-4 grid-cols-[minmax(0,1fr)] " +
  "[@container(min-width:560px)]:grid-cols-[minmax(0,1fr)_8.5rem] " +
  "[@container(min-width:760px)]:grid-cols-[minmax(0,1fr)_8.5rem_10rem] " +
  "[@container(min-width:960px)]:grid-cols-[minmax(0,1fr)_8.5rem_10rem_9rem]";

export function ProjectListHeader(): React.ReactElement {
  const label = "text-2xs font-medium uppercase tracking-wide text-subtle-foreground";
  return (
    <div className={cx(PROJECT_ROW_GRID, "hidden px-3 pb-1.5 [@container(min-width:560px)]:grid")} aria-hidden>
      <span className={label}>Проект</span>
      <span className={label}>Состояние</span>
      <span className={cx(label, "hidden [@container(min-width:760px)]:block")}>Срок</span>
      <span className={cx(label, "hidden [@container(min-width:960px)]:block")}>Прогресс</span>
    </div>
  );
}

/**
 * One project as a dense row (Linear-style): you scan a column of states and
 * deadlines instead of reading cards. The second line carries "what next", so
 * the row still answers "what is happening here" without opening the project.
 */
export function ProjectRow({
  project,
  nextAction,
  tasksOn,
  onOpen,
  itemProps
}: {
  project: Project;
  nextAction: ProjectNextAction | undefined;
  tasksOn: boolean;
  onOpen: () => void;
  /** Drag / keyboard-reorder handlers of the list item ("Мой порядок"). */
  itemProps?: React.HTMLAttributes<HTMLLIElement>;
}): React.ReactElement {
  const swatch = projectSwatchColor(project.color);
  const progress = Math.min(100, Math.max(0, project.progress));
  const live = project.status === "active" && !project.archivedAt;
  const freshness = reportFreshness(project);
  const overdueTasks = nextAction?.overdue ?? 0;

  return (
    <li {...itemProps}>
      <div
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
        className={cx(
          PROJECT_ROW_GRID,
          "cursor-pointer rounded-lg px-3 py-2.5 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          !live && "opacity-75"
        )}
      >
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full bg-white/20"
              style={swatch ? { backgroundColor: swatch } : undefined}
              aria-hidden
            />
            <span className="truncate text-body text-foreground">{project.name}</span>
            {overdueTasks > 0 ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-micro text-destructive" title="Просроченные задачи">
                <TriangleAlert className="h-3 w-3" aria-hidden />
                {overdueTasks}
              </span>
            ) : null}
          </p>
          {tasksOn ? (
            <p className="mt-0.5 truncate pl-[1.125rem] text-label">
              <NextLine live={live} tasksCount={project.counts.tasks} nextAction={nextAction} />
            </p>
          ) : project.description ? (
            <p className="mt-0.5 truncate pl-[1.125rem] text-label text-muted-foreground">{project.description}</p>
          ) : null}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1 [@container(min-width:560px)]:mt-0">
          <ReportedHealthBadge project={project} />
          {project.status !== "active" ? <Badge tone={STATUS_TONE[project.status]}>{PROJECT_STATUS_LABEL[project.status]}</Badge> : null}
          {freshness.kind === "stale" ? (
            <span className="text-micro text-warning" title="Автор давно не обновлял состояние проекта">
              {pluralDays(freshness.daysOld)}
            </span>
          ) : null}
          {/* The deadline column only exists on wide lists: below that, the deadline joins the state cell. */}
          {project.status !== "completed" ? (
            <span className="[@container(min-width:760px)]:hidden">
              <DueChip project={project} />
            </span>
          ) : null}
        </div>

        <div className="hidden [@container(min-width:760px)]:block">
          {project.status !== "completed" ? <DueChip project={project} /> : null}
        </div>

        <div className="hidden [@container(min-width:960px)]:block">
          {tasksOn ? (
            <div className="flex items-center gap-2">
              <div className="w-20 shrink-0">
                <Meter value={progress} tone={progress === 100 ? "success" : "accent"} color={swatch} />
              </div>
              <span className="font-mono text-micro tabular-nums text-subtle-foreground">{progress}%</span>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

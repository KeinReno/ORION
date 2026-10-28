"use client";

import type { Project, ProjectStatus } from "@orion/shared-types";
import { cx } from "@orion/ui";
import { Pin } from "lucide-react";
import { primaryAttentionReason, type ProjectAttention, type ProjectNextAction } from "../../lib/project-status";
import { projectSwatchColor } from "../project-form";
import { NextLine, ProjectStatusMenu } from "./project-vitals";

/**
 * «Сводка» (ORION-08): the third density, for a catalogue of 50–100 projects where cards or even
 * the row list cost too much vertical space per project. Grouped by what it needs from you today —
 * same `projectAttention` score the band already uses, not a new signal — rather than by status, so
 * the thing worth looking at first is also first on screen. Quick status change stays the one
 * control every density shares (`ProjectStatusMenu`); nothing here invents a second interaction.
 */
export function ProjectOpsView({
  projects,
  attentionByProject,
  nextActions,
  pinned,
  onTogglePin,
  onChangeStatus,
  onOpen
}: {
  projects: readonly Project[];
  attentionByProject: ReadonlyMap<string, ProjectAttention | null>;
  nextActions: ReadonlyMap<string, ProjectNextAction>;
  pinned: ReadonlySet<string>;
  onTogglePin: (id: string) => void;
  onChangeStatus: (project: Project, status: ProjectStatus) => void;
  onOpen: (project: Project) => void;
}): React.ReactElement {
  const needsLook: Project[] = [];
  const active: Project[] = [];
  const other: Project[] = [];
  for (const project of projects) {
    const attention = attentionByProject.get(project.id);
    if (project.status !== "active") other.push(project);
    else if (attention) needsLook.push(project);
    else active.push(project);
  }
  needsLook.sort((a, b) => (attentionByProject.get(b.id)?.score ?? 0) - (attentionByProject.get(a.id)?.score ?? 0));

  return (
    <div className="flex flex-col gap-4">
      <OpsGroup title="Требует внимания" tone="warning" projects={needsLook} {...{ attentionByProject, nextActions, pinned, onTogglePin, onChangeStatus, onOpen }} />
      <OpsGroup title="В работе" projects={active} {...{ attentionByProject, nextActions, pinned, onTogglePin, onChangeStatus, onOpen }} />
      <OpsGroup title="На паузе / завершено" projects={other} {...{ attentionByProject, nextActions, pinned, onTogglePin, onChangeStatus, onOpen }} muted />
    </div>
  );
}

function OpsGroup({
  title,
  tone,
  muted,
  projects,
  attentionByProject,
  nextActions,
  pinned,
  onTogglePin,
  onChangeStatus,
  onOpen
}: {
  title: string;
  tone?: "warning";
  muted?: boolean;
  projects: readonly Project[];
  attentionByProject: ReadonlyMap<string, ProjectAttention | null>;
  nextActions: ReadonlyMap<string, ProjectNextAction>;
  pinned: ReadonlySet<string>;
  onTogglePin: (id: string) => void;
  onChangeStatus: (project: Project, status: ProjectStatus) => void;
  onOpen: (project: Project) => void;
}): React.ReactElement | null {
  if (projects.length === 0) return null;
  return (
    <section>
      <h3 className={cx("mb-1.5 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide", tone === "warning" ? "text-warning" : "text-subtle-foreground")}>
        {title}
        <span className="font-mono text-subtle-foreground">{projects.length}</span>
      </h3>
      <ul className={cx("rounded-xl border border-border bg-card/40", muted && "opacity-80")}>
        {projects.map((project) => {
          const attention = attentionByProject.get(project.id) ?? null;
          const dueShown = project.status !== "completed";
          const reason = primaryAttentionReason(attention, dueShown);
          const swatch = projectSwatchColor(project.color);
          const isPinned = pinned.has(project.id);
          return (
            <li key={project.id} className="flex items-center gap-2 border-b border-border/60 px-2 py-1.5 last:border-b-0 hover:bg-card-hover">
              <button
                type="button"
                onClick={() => onTogglePin(project.id)}
                aria-pressed={isPinned}
                aria-label={isPinned ? "Открепить" : "Закрепить"}
                title={isPinned ? "Открепить" : "Закрепить"}
                className={cx("shrink-0 rounded p-1", isPinned ? "text-accent-text" : "text-subtle-foreground hover:text-foreground")}
              >
                <Pin className={cx("h-3 w-3", isPinned && "fill-current")} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onOpen(project)}
                className="flex min-w-0 shrink-0 items-center gap-1.5 text-left text-label text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                style={{ width: "11rem" }}
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-white/20" style={swatch ? { backgroundColor: swatch } : undefined} aria-hidden />
                <span className="truncate">{project.name}</span>
              </button>
              <span className="min-w-0 flex-1 truncate text-micro text-warning">{reason}</span>
              <span className="min-w-0 flex-[1.4] truncate text-micro text-subtle-foreground">
                <NextLine live={project.status === "active" && !project.archivedAt} tasksCount={project.counts.tasks} nextAction={nextActions.get(project.id)} />
              </span>
              <span className="shrink-0" onClick={(event) => event.stopPropagation()}>
                <ProjectStatusMenu status={project.status} disabled={Boolean(project.archivedAt)} onChange={(status) => onChangeStatus(project, status)} />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

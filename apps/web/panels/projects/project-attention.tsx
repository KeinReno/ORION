"use client";

import type { Project } from "@orion/shared-types";
import { cx } from "@orion/ui";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { ProjectAttention, ProjectNextAction } from "../../lib/project-status";
import { projectSwatchColor } from "../project-form";
import { NextLine } from "./project-vitals";

const COLLAPSED_COUNT = 3;

/**
 * "Требует внимания": the first thing the board answers — which live projects have a stated reason
 * to be opened today (the author's own delay/risk, a passed deadline, overdue tasks, a stale report).
 * Every reason is a sentence, not a colour; projects with no reason are simply absent from the band
 * (silence is not "all fine"). It only points at projects — they stay in the list below, with the same
 * open command, so nothing about the board changes when the band is empty.
 */
export function ProjectAttentionBand({
  items,
  nextActions,
  tasksOn,
  onOpen
}: {
  items: readonly { project: Project; attention: ProjectAttention }[];
  nextActions: ReadonlyMap<string, ProjectNextAction>;
  tasksOn: boolean;
  onOpen: (project: Project) => void;
}): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, COLLAPSED_COUNT);
  return (
    <section aria-label="Требует внимания" className="rounded-xl border border-warning/30 bg-warning/[0.04]">
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
        <h2 className="flex items-center gap-1.5 text-label font-medium text-foreground">
          <TriangleAlert className="h-3.5 w-3.5 text-warning" aria-hidden />
          Требует внимания
          <span className="font-mono text-micro tabular-nums text-subtle-foreground">{items.length}</span>
        </h2>
        {items.length > COLLAPSED_COUNT ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="rounded px-1.5 py-0.5 text-micro text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {expanded ? "Свернуть" : `Показать все (${items.length})`}
          </button>
        ) : null}
      </div>
      <ul className="flex flex-col p-1.5">
        {shown.map(({ project, attention }) => {
          const swatch = projectSwatchColor(project.color);
          return (
            <li key={project.id}>
              <button
                type="button"
                aria-label={`Требует внимания: «${project.name}» — ${attention.reasons.join(", ")}. Открыть`}
                onClick={() => onOpen(project)}
                className={cx(
                  "group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-card-hover",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                )}
              >
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 self-start rounded-full bg-white/20" style={swatch ? { backgroundColor: swatch } : undefined} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-foreground">{project.name}</span>
                  <span className="block text-label text-warning">{attention.reasons.join(" · ")}</span>
                  {tasksOn ? (
                    <span className="mt-0.5 block truncate text-label">
                      <NextLine live tasksCount={project.counts.tasks} nextAction={nextActions.get(project.id)} />
                    </span>
                  ) : null}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

"use client";

import type { Milestone, Task } from "@orion/shared-types";
import { cx } from "@orion/ui";
import { shortDate } from "../../lib/format";
import { projectDueLabel } from "../../lib/project-status";

/**
 * The first screen of a project in four cells: what is on fire, what comes next, the nearest
 * milestone and the deadline — each a plain sentence that also jumps to where it is worked on.
 * It repeats nothing new: every cell is derived from data the sections below already show, and a
 * cell without data is left out instead of inventing "all fine".
 */
export function OverviewGlance({
  project,
  fireCount,
  next,
  milestone,
  onOpenTask,
  onGoTasks,
  onGoPlan
}: {
  project: { status: string; dueAt: string | null };
  fireCount: number;
  next: Task | null;
  milestone: Milestone | null;
  onOpenTask: (task: Task) => void;
  onGoTasks: () => void;
  onGoPlan: (() => void) | null;
}): React.ReactElement | null {
  const due = projectDueLabel(project);
  const cells: { key: string; label: string; value: string; hint?: string; tone?: "danger" | "warning"; onClick?: () => void }[] = [];
  if (fireCount > 0) cells.push({ key: "fire", label: "Горит", value: `${fireCount} ${fireCount === 1 ? "задача" : "задач"}`, hint: "просрочено или заблокировано", tone: "danger", onClick: onGoTasks });
  if (next) cells.push({ key: "next", label: "Дальше", value: next.title, onClick: () => onOpenTask(next) });
  if (milestone) cells.push({ key: "milestone", label: "Ближайшая веха", value: milestone.title, hint: milestone.dueAt ? `до ${shortDate(milestone.dueAt)}` : "без срока", onClick: onGoPlan ?? undefined });
  if (due) cells.push({ key: "due", label: "Срок проекта", value: due.text, hint: project.dueAt ? shortDate(project.dueAt) : undefined, tone: due.tone === "danger" ? "danger" : due.tone === "warning" ? "warning" : undefined });
  if (cells.length === 0) return null;
  return (
    <dl aria-label="Сейчас" className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-2">
      {cells.map((cell) => {
        const body = (
          <>
            <dt className="text-2xs font-medium uppercase tracking-wide text-subtle-foreground">{cell.label}</dt>
            <dd className={cx("mt-0.5 line-clamp-2 text-body", cell.tone === "danger" ? "text-destructive" : cell.tone === "warning" ? "text-warning" : "text-foreground")}>{cell.value}</dd>
            {cell.hint ? <dd className="truncate text-label text-subtle-foreground">{cell.hint}</dd> : null}
          </>
        );
        const base = "min-w-0 rounded-xl border border-border bg-card/40 px-3 py-2 text-left";
        return cell.onClick ? (
          <button key={cell.key} type="button" onClick={cell.onClick} className={cx(base, "transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60")}>
            {body}
          </button>
        ) : (
          <div key={cell.key} className={base}>{body}</div>
        );
      })}
    </dl>
  );
}

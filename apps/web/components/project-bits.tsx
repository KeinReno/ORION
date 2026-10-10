import { PROJECT_HEALTH_LABEL, type Project, type ProjectHealth, type ProjectStatus } from "@orion/shared-types";
import { Badge, cx } from "@orion/ui";
import { relativeTime } from "../lib/format";

/** Shared by the project board (`ProjectsPanel`) and a project's own tab (`ProjectWorkspacePanel`). */
export const STATUS_TONE: Record<ProjectStatus, "accent" | "warning" | "success"> = {
  active: "accent",
  on_hold: "warning",
  completed: "success"
};

export const HEALTH_TONE: Record<ProjectHealth, "success" | "warning" | "danger"> = {
  on_track: "success",
  at_risk: "warning",
  delayed: "danger"
};

/**
 * What the project's author last *said* about it ("по плану / есть риск /
 * задержка"), with its age in the tooltip. Nothing when nobody has reported:
 * an absent report must not read as "all fine". Kept apart from the computed
 * "Просрочен"/progress indicators on purpose.
 */
export function ReportedHealthBadge({ project }: { project: Pick<Project, "reportedHealth" | "reportedAt"> }): React.ReactElement | null {
  if (!project.reportedHealth) return null;
  return (
    <span title={project.reportedAt ? `Отчёт автора · ${relativeTime(project.reportedAt)}` : "Отчёт автора"}>
      <Badge tone={HEALTH_TONE[project.reportedHealth]}>{PROJECT_HEALTH_LABEL[project.reportedHealth]}</Badge>
    </span>
  );
}

export function taskProgressLabel(project: Project): string {
  if (project.counts.tasks === 0) return "Нет задач";
  return `${project.counts.closed} из ${project.counts.tasks} · ${project.progress}%`;
}

export function Meter({
  value,
  tone = "accent",
  color
}: {
  value: number;
  tone?: "accent" | "danger" | "success";
  color?: string;
}): React.ReactElement {
  const fill =
    tone === "danger" ? "bg-destructive" : tone === "success" ? "bg-success" : "bg-accent";
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className={cx("h-full rounded-full transition-[width] duration-500 ease-out", color ? "" : fill)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color }}
      />
    </div>
  );
}

import type { Project, ProjectStatus } from "@orion/shared-types";
import { cx } from "@orion/ui";

/** Shared by the project board (`ProjectsPanel`) and a project's own tab (`ProjectWorkspacePanel`). */
export const STATUS_TONE: Record<ProjectStatus, "accent" | "warning" | "success"> = {
  active: "accent",
  on_hold: "warning",
  completed: "success"
};

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

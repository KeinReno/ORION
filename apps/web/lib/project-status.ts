import { isTaskClosed, type Milestone, type Task } from "@orion/shared-types";
import { projectFocus } from "./project-focus";

/**
 * What a project says about itself on a board card and on its overview:
 * how close the deadline is, how current the author's last report is, whether
 * that report disagrees with the computed facts, the plan as a short strip,
 * and "what next" for every project at once. Framework-free so it is tested
 * (project-status.test.ts); the panels only pick words and colours.
 */

/** Calendar days from `now` to `iso` (negative = in the past), local-day based so "today" is 0. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const due = new Date(iso);
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const b = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "день" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "дня" : "дней";
  return `${n} ${word}`;
}

export type DueTone = "neutral" | "warning" | "danger" | "success";

export interface DueLabel {
  text: string;
  tone: DueTone;
}

/**
 * One short phrase about a project's deadline — "через 12 дней", "срок сегодня",
 * "просрочен на 3 дня". A finished project says so instead of counting down;
 * no deadline = no phrase (null), never an invented one.
 */
export function projectDueLabel(project: { status: string; dueAt: string | null }, now: Date = new Date()): DueLabel | null {
  if (project.status === "completed") return { text: "Завершён", tone: "success" };
  if (!project.dueAt) return null;
  const days = daysUntil(project.dueAt, now);
  if (days < 0) return { text: `просрочен на ${pluralDays(-days)}`, tone: "danger" };
  if (days === 0) return { text: "срок сегодня", tone: "warning" };
  if (days <= 7) return { text: `через ${pluralDays(days)}`, tone: "warning" };
  return { text: `через ${pluralDays(days)}`, tone: "neutral" };
}

/** A manual report older than this on an active project is worth a nudge, not a verdict. */
export const REPORT_STALE_DAYS = 14;

export type ReportFreshness = { kind: "none" } | { kind: "fresh"; daysOld: number } | { kind: "stale"; daysOld: number };

/**
 * How current the author's last report is. "none" is its own state (it must not
 * read as "all fine"); "stale" applies only to projects still in motion — a
 * paused or finished project has nothing to report.
 */
export function reportFreshness(project: { status: string; reportedAt: string | null }, now: Date = new Date()): ReportFreshness {
  if (!project.reportedAt) return { kind: "none" };
  const daysOld = Math.max(0, -daysUntil(project.reportedAt, now));
  return project.status === "active" && daysOld > REPORT_STALE_DAYS ? { kind: "stale", daysOld } : { kind: "fresh", daysOld };
}

/**
 * The author said "по плану" while computed facts say otherwise (overdue tasks
 * or a missed deadline). Surfaced as a quiet mismatch note — it never overrides
 * what the person wrote, and it is not shown for "есть риск"/"задержка"
 * (those already agree with bad news) or when nobody reported.
 */
export function reportContradicted(
  project: { reportedHealth: string | null; status: string; dueAt: string | null },
  overdueTasks: number,
  now: Date = new Date()
): boolean {
  if (project.reportedHealth !== "on_track") return false;
  return overdueTasks > 0 || (project.status !== "completed" && project.dueAt !== null && daysUntil(project.dueAt, now) < 0);
}

export type PlanStepState = "done" | "current" | "upcoming" | "overdue";

export interface PlanStep {
  milestone: Milestone;
  total: number;
  closed: number;
  state: PlanStepState;
}

/**
 * The project plan as one short strip: milestones in the project's order, each
 * with its task tally and a state. The first not-done milestone is "current";
 * a milestone past its date and not done is "overdue" (takes precedence), so a
 * slipped stage stays visible even when it is no longer the nearest one.
 */
export function planStrip(milestones: readonly Milestone[], tasks: readonly Task[], now: Date = new Date()): PlanStep[] {
  const ordered = [...milestones].sort((a, b) => a.order - b.order);
  const currentId = ordered.find((milestone) => milestone.status !== "done")?.id ?? null;
  return ordered.map((milestone) => {
    const own = tasks.filter((task) => task.milestoneId === milestone.id);
    const closed = own.filter((task) => isTaskClosed(task.status)).length;
    const late = milestone.status !== "done" && milestone.dueAt !== null && Date.parse(milestone.dueAt) < now.getTime();
    const state: PlanStepState =
      milestone.status === "done" ? "done" : late ? "overdue" : milestone.id === currentId ? "current" : "upcoming";
    return { milestone, total: own.length, closed, state };
  });
}

export interface ProjectNextAction {
  /** The single most useful open, unblocked task. Null when nothing is actionable right now. */
  next: Task | null;
  open: number;
  overdue: number;
}

/**
 * "Что дальше" for every project at once, from one workspace task list — the
 * board card's answer to "what is going on here" without opening the project.
 */
export function nextActionByProject(tasks: readonly Task[], now: Date = new Date()): Map<string, ProjectNextAction> {
  const byProject = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.projectId) continue;
    const list = byProject.get(task.projectId) ?? [];
    list.push(task);
    byProject.set(task.projectId, list);
  }
  const result = new Map<string, ProjectNextAction>();
  for (const [projectId, own] of byProject) {
    const focus = projectFocus(own, [], now, 1);
    result.set(projectId, { next: focus.next[0] ?? null, open: focus.open, overdue: focus.overdue.length });
  }
  return result;
}

export interface ProjectAttention {
  /** Reasons in words, most serious first. Never empty for an item returned by `projectsNeedingAttention`. */
  reasons: string[];
  /** Sort key: higher = look at it first. */
  score: number;
}

/**
 * Why a live project deserves a look today — stated, not scored: the author's own "delay / risk",
 * a passed deadline, overdue tasks, a stale report. Paused, finished and archived projects expect
 * nothing, so they are never flagged. No reasons = null (the absence is not "all fine").
 */
export function projectAttention(
  project: { status: string; archivedAt: string | null; dueAt: string | null; reportedHealth: string | null; reportedAt: string | null },
  nextAction: ProjectNextAction | undefined,
  now: Date = new Date()
): ProjectAttention | null {
  if (project.status !== "active" || project.archivedAt) return null;
  const reasons: string[] = [];
  let score = 0;
  if (project.reportedHealth === "delayed") { reasons.push("Автор отметил задержку"); score += 8; }
  if (project.dueAt && daysUntil(project.dueAt, now) < 0) { reasons.push(`Срок прошёл ${pluralDays(-daysUntil(project.dueAt, now))} назад`); score += 6; }
  if (nextAction && nextAction.overdue > 0) { reasons.push(`Просрочено задач: ${nextAction.overdue}`); score += 4 + Math.min(nextAction.overdue, 3); }
  if (project.reportedHealth === "at_risk") { reasons.push("Автор отметил риск"); score += 5; }
  const freshness = reportFreshness(project, now);
  if (freshness.kind === "stale") { reasons.push(`Отчёту ${pluralDays(freshness.daysOld)}`); score += 1; }
  return reasons.length > 0 ? { reasons, score } : null;
}

/** Projects worth a look, most urgent first (ties: by name, so the order is stable). */
export function projectsNeedingAttention<T extends { id: string; name: string; status: string; archivedAt: string | null; dueAt: string | null; reportedHealth: string | null; reportedAt: string | null }>(
  projects: readonly T[],
  nextActions: ReadonlyMap<string, ProjectNextAction>,
  now: Date = new Date()
): { project: T; attention: ProjectAttention }[] {
  const flagged: { project: T; attention: ProjectAttention }[] = [];
  for (const project of projects) {
    const attention = projectAttention(project, nextActions.get(project.id), now);
    if (attention) flagged.push({ project, attention });
  }
  return flagged.sort((a, b) => b.attention.score - a.attention.score || a.project.name.localeCompare(b.project.name, "ru"));
}

/** The milestone to look at next: not done, soonest deadline first, undated ones last. */
export function nearestMilestone(milestones: readonly Milestone[]): Milestone | null {
  const open = milestones.filter((milestone) => milestone.status !== "done");
  const key = (m: Milestone): number => (m.dueAt ? Date.parse(m.dueAt) : Number.POSITIVE_INFINITY);
  open.sort((a, b) => (key(a) === key(b) ? a.order - b.order : key(a) - key(b)));
  return open[0] ?? null;
}

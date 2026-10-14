import { z } from "zod";
import { isTaskClosed, type TaskStatus } from "./task";
import { projectHealthSchema } from "./project-update";
import { timeCostMinor } from "./time";

export const projectStatusSchema = z.enum(["active", "on_hold", "completed"]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

/**
 * Meaningful list order — not alphabetical. Prisma `orderBy: { status: "asc" }`
 * would put `completed` above `on_hold` because "c" < "o".
 */
export const PROJECT_STATUS_ORDER: readonly ProjectStatus[] = ["active", "on_hold", "completed"];

/**
 * Share of a project's tasks that are no longer open. Canceled counts as
 * closed (same `isTaskClosed` rule as overdue/reminders) so 3 done + 2
 * canceled is 100%, not 60%. Empty project → 0, not NaN.
 */
export function projectTaskRollup(
  statusCounts: ReadonlyArray<{ status: string; count: number }>
): { taskCount: number; closedCount: number; progress: number } {
  const taskCount = statusCounts.reduce((sum, entry) => sum + entry.count, 0);
  const closedCount = statusCounts.reduce(
    (sum, entry) => sum + (isTaskClosed(entry.status as TaskStatus) ? entry.count : 0),
    0
  );
  return {
    taskCount,
    closedCount,
    progress: taskCount === 0 ? 0 : Math.round((closedCount / taskCount) * 100)
  };
}

export function projectTaskProgress(statusCounts: ReadonlyArray<{ status: string; count: number }>): number {
  return projectTaskRollup(statusCounts).progress;
}

function dueTimestamp(dueAt: Date | string | null): number {
  if (!dueAt) return Number.POSITIVE_INFINITY;
  const ms = dueAt instanceof Date ? dueAt.getTime() : Date.parse(dueAt);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/** Active → on hold → completed, then soonest due, then name. Null dueAt sorts last. */
export function compareProjectsByLifecycle<T extends { status: string; dueAt: Date | string | null; name: string }>(
  a: T,
  b: T
): number {
  const rank = (status: string): number => {
    const index = PROJECT_STATUS_ORDER.indexOf(status as ProjectStatus);
    return index === -1 ? PROJECT_STATUS_ORDER.length : index;
  };
  const byStatus = rank(a.status) - rank(b.status);
  if (byStatus !== 0) return byStatus;
  // Both null (or both otherwise unparseable) due dates are Infinity - Infinity
  // = NaN, which must fall through to the name compare rather than be returned
  // as-is — a NaN comparator result makes Array.prototype.sort's order depend
  // on the input array's incidental order instead of the intended tie-break.
  const byDue = dueTimestamp(a.dueAt) - dueTimestamp(b.dueAt);
  if (byDue !== 0 && !Number.isNaN(byDue)) return byDue;
  return a.name.localeCompare(b.name, "ru");
}

/** Past `dueAt` and not completed — on-hold still counts; completed never does. */
export function isProjectOverdue(
  project: { status: string; dueAt: Date | string | null },
  now: Date = new Date()
): boolean {
  if (project.status === "completed" || !project.dueAt) return false;
  const ms = project.dueAt instanceof Date ? project.dueAt.getTime() : Date.parse(project.dueAt);
  return Number.isFinite(ms) && ms < now.getTime();
}

/**
 * Hours on a project plus what they cost at this project's rate.
 * Unknown rate → `timeCost` null and every minute in `unratedMinutes`;
 * explicit 0 ₽/час → cost 0, fully rated. Same rule as `timeCostMinor`.
 */
export function projectTimeRollup(
  trackedMinutes: number,
  hourlyRateMinor: number | null
): { trackedMinutes: number; timeCost: number | null; unratedMinutes: number } {
  const minutes = Math.max(0, Math.round(trackedMinutes));
  const timeCost = timeCostMinor(minutes, hourlyRateMinor);
  return {
    trackedMinutes: minutes,
    timeCost,
    unratedMinutes: timeCost === null ? minutes : 0
  };
}

export const projectSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  description: z.string(),
  status: projectStatusSchema,
  color: z.string().nullable(),
  startAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  budgetAmount: z.number().int().nullable(),
  /**
   * Ставка за час в копейках (v0.19). Null = не задана: стоимость по времени
   * тогда не считается вовсе, потому что «0 ₽/час» — это утверждение «работа
   * бесплатна», а не «мы не знаем».
   */
  hourlyRate: z.number().int().nonnegative().nullable(),
  currency: z.string(),
  /** «Где я остановился» — operational scratchpad, not a Notes document. See schema.prisma. */
  contextNote: z.string(),
  /** Team-shared board order (0-based); null = not placed yet. Written only via the reorder endpoint. */
  sharedOrder: z.number().int().nullable(),
  /**
   * The author-reported health from the newest status update (UI-05), or null
   * when nobody has reported. Deliberately separate from `progress`/overdue,
   * which are computed: this one is a person's statement with a date.
   */
  reportedHealth: projectHealthSchema.nullable(),
  reportedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  progress: z.number().min(0).max(100),
  counts: z.object({
    tasks: z.number().int(),
    /** Closed tasks (`isTaskClosed`) — so the UI can say "8 из 12", not just "66%". */
    closed: z.number().int(),
    notes: z.number().int(),
    events: z.number().int(),
    documents: z.number().int(),
    /** Non-archived InventoryItem rows pointed at this project (v0.26+, U07 adapter). */
    inventory: z.number().int()
  }),
  spentAmount: z.number().int(),
  /** Minutes from TimeEntry rows on this project (running timer counted up to "now"). */
  trackedMinutes: z.number().int().nonnegative(),
  /**
   * Cost of `trackedMinutes` at `hourlyRate`, kopecks. Null = rate unknown,
   * not "free" — see `timeCostMinor`.
   */
  timeCost: z.number().int().nullable(),
  /** Minutes whose cost is unknown (no rate). 0 when the rate is set, even if it is 0. */
  unratedMinutes: z.number().int().nonnegative(),
  /**
   * План-часы (v0.27): sum of `Task.estimatedMinutes` over this project's
   * tasks. Null = nothing estimated yet, not zero — same "null ≠ 0" rule as
   * `hourlyRate`. Deliberately *not* also summed from `Milestone.estimatedMinutes`:
   * a milestone's own estimate is a separate planning granularity shown on
   * the Gantt itself, and adding both would silently double-count effort
   * that's estimated at both levels.
   */
  plannedMinutes: z.number().int().nonnegative().nullable(),
  /** Newest `updatedAt` across this project's tasks/notes/events/documents/transactions/time entries — "открывали N дней назад". Null for a project with no activity yet. */
  lastActivityAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Project = z.infer<typeof projectSchema>;

export const projectActivitySchema = z.object({
  id: z.string(),
  type: z.enum(["task", "note", "event", "document", "transaction", "milestone", "inventory"]),
  title: z.string(),
  at: z.string(),
  status: z.string().nullable()
});
export type ProjectActivity = z.infer<typeof projectActivitySchema>;

export const projectDetailSchema = projectSchema.extend({
  activity: z.array(projectActivitySchema)
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

const projectBody = {
  name: z.string().trim().min(1, "Название обязательно").max(120),
  description: z.string().max(20_000).default(""),
  status: projectStatusSchema.default("active"),
  color: z.string().max(40).nullable().optional(),
  startAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  budgetAmount: z.number().int().nonnegative().nullable().optional(),
  hourlyRate: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().length(3).default("RUB"),
  contextNote: z.string().max(4_000).optional()
};

export const createProjectInputSchema = z.object(projectBody);
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export const updateProjectInputSchema = z.object(projectBody).partial().extend({
  archivedAt: z.string().datetime().nullable().optional()
});
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

/** Owner/lead write the whole shared board order in one request (ids of the visible list, top to bottom). */
export const reorderProjectsInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(2000)
});
export type ReorderProjectsInput = z.infer<typeof reorderProjectsInputSchema>;

/**
 * «Порядок команды»: placed projects first by `sharedOrder`, unplaced ones after them in the
 * lifecycle order. Pure — the panel and tests share it.
 */
export function compareProjectsBySharedOrder<T extends { sharedOrder: number | null; status: string; dueAt: Date | string | null; name: string }>(
  a: T,
  b: T
): number {
  if (a.sharedOrder !== null && b.sharedOrder !== null && a.sharedOrder !== b.sharedOrder) return a.sharedOrder - b.sharedOrder;
  if (a.sharedOrder !== null && b.sharedOrder === null) return -1;
  if (a.sharedOrder === null && b.sharedOrder !== null) return 1;
  return compareProjectsByLifecycle(a, b);
}

/**
 * Normalises a requested order: drops duplicates (first wins) and ids the workspace no longer
 * has (stale), keeping the requested sequence. `foreign` lists ids that exist but belong elsewhere.
 */
export function normaliseProjectOrder(
  requested: readonly string[],
  workspaceIds: ReadonlySet<string>,
  knownElsewhere: ReadonlySet<string> = new Set()
): { ids: string[]; foreign: string[] } {
  const seen = new Set<string>();
  const ids: string[] = [];
  const foreign: string[] = [];
  for (const id of requested) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (workspaceIds.has(id)) ids.push(id);
    else if (knownElsewhere.has(id)) foreign.push(id);
  }
  return { ids, foreign };
}

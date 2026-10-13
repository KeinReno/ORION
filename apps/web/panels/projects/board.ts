import {
  compareProjectsByLifecycle,
  isProjectOverdue,
  type Project,
  type ProjectStatus
} from "@orion/shared-types";

/**
 * Client-side board helpers for the projects panel. Search, status chips and
 * sort run on the already-loaded list (same choice as Notes/Tasks — no extra
 * endpoint). The rollup is computed from that list *before* search, so hiding
 * a card does not hide that you have three overdue projects.
 */

export type ProjectBoardSort = "lifecycle" | "manual" | "name" | "due" | "progress" | "spent" | "time";

export const PROJECT_BOARD_SORT_LABEL: Record<ProjectBoardSort, string> = {
  lifecycle: "По статусу",
  manual: "Мой порядок",
  name: "По названию",
  due: "По сроку",
  progress: "По прогрессу",
  spent: "По расходам",
  time: "По времени"
};

export interface ProjectMoneyTotal {
  currency: string;
  budget: number;
  spent: number;
  /** Sum of known `timeCost` values; omitted from the UI when `timeCostKnown` is false. */
  timeCost: number;
  timeCostKnown: boolean;
}

export interface ProjectBoardSummary {
  total: number;
  byStatus: Record<ProjectStatus, number>;
  overdue: number;
  trackedMinutes: number;
  unratedMinutes: number;
  money: ProjectMoneyTotal[];
}

export function summariseProjectBoard(projects: Project[], now: Date = new Date()): ProjectBoardSummary {
  const byStatus: Record<ProjectStatus, number> = { active: 0, on_hold: 0, completed: 0 };
  const money = new Map<string, ProjectMoneyTotal>();
  let overdue = 0;
  let trackedMinutes = 0;
  let unratedMinutes = 0;

  for (const project of projects) {
    byStatus[project.status] += 1;
    if (isProjectOverdue(project, now)) overdue += 1;
    trackedMinutes += project.trackedMinutes;
    unratedMinutes += project.unratedMinutes;
    const bucket = money.get(project.currency) ?? {
      currency: project.currency,
      budget: 0,
      spent: 0,
      timeCost: 0,
      timeCostKnown: false
    };
    bucket.budget += project.budgetAmount ?? 0;
    bucket.spent += project.spentAmount;
    if (project.timeCost !== null) {
      bucket.timeCost += project.timeCost;
      bucket.timeCostKnown = true;
    }
    money.set(project.currency, bucket);
  }

  return {
    total: projects.length,
    byStatus,
    overdue,
    trackedMinutes,
    unratedMinutes,
    money: [...money.values()].sort((a, b) => b.spent - a.spent)
  };
}

export function visibleProjectBoard(
  projects: Project[],
  query: string,
  status: ProjectStatus | null,
  sort: ProjectBoardSort
): Project[] {
  const q = query.trim().toLowerCase();
  const filtered = projects.filter((project) => {
    if (status && project.status !== status) return false;
    if (!q) return true;
    return project.name.toLowerCase().includes(q) || project.description.toLowerCase().includes(q);
  });
  return filtered.sort((a, b) => compareProjectBoard(a, b, sort));
}

function compareProjectBoard(a: Project, b: Project, sort: ProjectBoardSort): number {
  if (sort === "lifecycle" || sort === "manual") return compareProjectsByLifecycle(a, b);
  if (sort === "name") return a.name.localeCompare(b.name, "ru");
  if (sort === "due") {
    const byDue = dueMs(a.dueAt) - dueMs(b.dueAt);
    return byDue !== 0 ? byDue : a.name.localeCompare(b.name, "ru");
  }
  if (sort === "progress") return b.progress - a.progress || a.name.localeCompare(b.name, "ru");
  if (sort === "spent") return b.spentAmount - a.spentAmount || a.name.localeCompare(b.name, "ru");
  return b.trackedMinutes - a.trackedMinutes || a.name.localeCompare(b.name, "ru");
}

function dueMs(dueAt: string | null): number {
  if (!dueAt) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(dueAt);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

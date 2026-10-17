import type { Milestone, Task } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import {
  daysUntil,
  nearestMilestone,
  nextActionByProject,
  planStrip,
  pluralDays,
  projectAttention,
  projectDueLabel,
  projectsNeedingAttention,
  reportContradicted,
  reportFreshness
} from "./project-status";

// Local noon on 20 Sep 2026. `daysUntil` counts local calendar days on purpose
// (a deadline "tomorrow" means tomorrow where the person is), so the fixtures
// are built from local dates and the suite doesn't depend on the machine zone.
const NOW = new Date(2026, 8, 20, 12, 0);
/** ISO instant at local `hour` on day `20 + dayOffset` of September 2026. */
const at = (dayOffset: number, hour = 12): string => new Date(2026, 8, 20 + dayOffset, hour, 0).toISOString();

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    revision: 1,
    workspaceId: "ws",
    projectId: "p",
    parentId: null,
    title: id,
    description: "",
    status: "todo",
    priority: "normal",
    dueAt: null,
    projectTag: null,
    recurrence: null,
    completedAt: null,
    sortOrder: 0,
    dependencyIds: [],
    blocked: false,
    assigneeId: null,
    startAt: null,
    estimatedMinutes: null,
    milestoneId: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...patch
  };
}

function milestone(id: string, order: number, patch: Partial<Milestone> = {}): Milestone {
  return {
    id,
    workspaceId: "ws",
    projectId: "p",
    title: id,
    note: "",
    status: "planned",
    startAt: null,
    dueAt: null,
    estimatedMinutes: null,
    order,
    dependencyIds: [],
    blocked: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...patch
  };
}

describe("project deadline wording", () => {
  const due = (iso: string | null, status = "active") => projectDueLabel({ status, dueAt: iso }, NOW);

  it("counts calendar days, with today as zero", () => {
    expect(daysUntil(at(0, 23), NOW)).toBe(0);
    expect(daysUntil(at(3), NOW)).toBe(3);
    expect(daysUntil(at(-2), NOW)).toBe(-2);
  });

  it("inflects the Russian plural", () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25].map(pluralDays)).toEqual([
      "1 день",
      "2 дня",
      "5 дней",
      "11 дней",
      "12 дней",
      "21 день",
      "22 дня",
      "25 дней"
    ]);
  });

  it("says nothing when there is no deadline, and never invents one", () => {
    expect(due(null)).toBeNull();
  });

  it("warns inside a week, turns red when missed, and calls a finished project finished", () => {
    expect(due(at(0, 18))).toEqual({ text: "срок сегодня", tone: "warning" });
    expect(due(at(4))).toEqual({ text: "через 4 дня", tone: "warning" });
    expect(due(at(30))).toEqual({ text: "через 30 дней", tone: "neutral" });
    expect(due(at(-3))).toEqual({ text: "просрочен на 3 дня", tone: "danger" });
    expect(due(at(-3), "completed")).toEqual({ text: "Завершён", tone: "success" });
  });
});

describe("report freshness", () => {
  it("distinguishes no report from a fresh one", () => {
    expect(reportFreshness({ status: "active", reportedAt: null }, NOW)).toEqual({ kind: "none" });
    expect(reportFreshness({ status: "active", reportedAt: at(-1) }, NOW)).toEqual({ kind: "fresh", daysOld: 1 });
  });

  it("goes stale after two weeks, but only for a project still in motion", () => {
    const old = at(-19);
    expect(reportFreshness({ status: "active", reportedAt: old }, NOW)).toEqual({ kind: "stale", daysOld: 19 });
    expect(reportFreshness({ status: "on_hold", reportedAt: old }, NOW)).toEqual({ kind: "fresh", daysOld: 19 });
    expect(reportFreshness({ status: "active", reportedAt: at(-14) }, NOW)).toEqual({ kind: "fresh", daysOld: 14 });
  });
});

describe("report vs computed facts", () => {
  const base = { reportedHealth: "on_track" as string | null, status: "active", dueAt: null as string | null };

  it("flags 'по плану' only when something computed disagrees", () => {
    expect(reportContradicted(base, 0, NOW)).toBe(false);
    expect(reportContradicted(base, 2, NOW)).toBe(true);
    expect(reportContradicted({ ...base, dueAt: at(-10) }, 0, NOW)).toBe(true);
    expect(reportContradicted({ ...base, dueAt: at(-10), status: "completed" }, 0, NOW)).toBe(false);
  });

  it("never second-guesses a report that already says there is trouble, or no report", () => {
    expect(reportContradicted({ ...base, reportedHealth: "delayed" }, 5, NOW)).toBe(false);
    expect(reportContradicted({ ...base, reportedHealth: "at_risk" }, 5, NOW)).toBe(false);
    expect(reportContradicted({ ...base, reportedHealth: null }, 5, NOW)).toBe(false);
  });
});

describe("planStrip", () => {
  it("marks done, the current stage, upcoming ones, and a slipped stage as overdue", () => {
    const milestones = [
      milestone("m1", 1, { status: "done" }),
      milestone("m2", 2, { dueAt: at(-10) }),
      milestone("m3", 3, { dueAt: at(70) }),
      milestone("m4", 4)
    ];
    const tasks = [
      task("a", { milestoneId: "m2", status: "done" }),
      task("b", { milestoneId: "m2" }),
      task("c", { milestoneId: "m3" })
    ];
    const strip = planStrip(milestones, tasks, NOW);
    expect(strip.map((step) => step.state)).toEqual(["done", "overdue", "upcoming", "upcoming"]);
    expect(strip[1]).toMatchObject({ total: 2, closed: 1 });
  });

  it("makes the first not-done stage current when nothing is late", () => {
    const strip = planStrip([milestone("m2", 2), milestone("m1", 1, { status: "done" })], [], NOW);
    expect(strip.map((step) => [step.milestone.id, step.state])).toEqual([
      ["m1", "done"],
      ["m2", "current"]
    ]);
  });

  it("is empty for a project without milestones", () => {
    expect(planStrip([], [task("a")], NOW)).toEqual([]);
  });
});

describe("nextActionByProject", () => {
  it("picks one actionable task per project and counts overdue/open", () => {
    const tasks = [
      task("p1-late", { projectId: "p1", dueAt: at(-19) }),
      task("p1-soon", { projectId: "p1", dueAt: at(5) }),
      task("p1-blocked", { projectId: "p1", blocked: true }),
      task("p1-done", { projectId: "p1", status: "done" }),
      task("p2-only-blocked", { projectId: "p2", blocked: true }),
      task("loose", { projectId: null })
    ];
    const result = nextActionByProject(tasks, NOW);
    expect(result.get("p1")).toMatchObject({ open: 3, overdue: 1 });
    expect(result.get("p1")?.next?.id).toBe("p1-late");
    expect(result.get("p2")).toMatchObject({ next: null, open: 1 });
    expect(result.has("p3")).toBe(false);
  });
});

describe("projectAttention", () => {
  const base = { status: "active", archivedAt: null, dueAt: null, reportedHealth: null, reportedAt: null };
  const action = (overdue: number) => ({ next: null, open: overdue, overdue });
  it("says nothing about a quiet project (absence is not 'all fine')", () => {
    expect(projectAttention(base, undefined, NOW)).toBeNull();
    expect(projectAttention({ ...base, reportedHealth: "on_track", reportedAt: at(-1) }, action(0), NOW)).toBeNull();
  });
  it("never flags paused, finished or archived projects", () => {
    const loud = { ...base, reportedHealth: "delayed", dueAt: at(-9) };
    expect(projectAttention({ ...loud, status: "on_hold" }, action(3), NOW)).toBeNull();
    expect(projectAttention({ ...loud, status: "completed" }, action(3), NOW)).toBeNull();
    expect(projectAttention({ ...loud, archivedAt: at(-1) }, action(3), NOW)).toBeNull();
  });
  it("lists reasons in words, most serious first", () => {
    const got = projectAttention({ ...base, reportedHealth: "delayed", dueAt: at(-3), reportedAt: at(-1) }, action(2), NOW)!;
    expect(got.reasons).toEqual(["Автор отметил задержку", "Срок прошёл 3 дня назад", "Просрочено задач: 2"]);
  });
  it("flags a stale report and a risk on their own", () => {
    expect(projectAttention({ ...base, reportedHealth: "on_track", reportedAt: at(-20) }, undefined, NOW)!.reasons).toEqual(["Отчёту 20 дней"]);
    expect(projectAttention({ ...base, reportedHealth: "at_risk", reportedAt: at(-1) }, undefined, NOW)!.reasons).toEqual(["Автор отметил риск"]);
  });
  it("orders flagged projects by urgency, then name", () => {
    const list = [
      { ...base, id: "a", name: "Б", reportedHealth: "at_risk", reportedAt: at(-1) },
      { ...base, id: "b", name: "А", reportedHealth: "delayed", reportedAt: at(-1) },
      { ...base, id: "c", name: "В" },
      { ...base, id: "d", name: "Я", reportedHealth: "at_risk", reportedAt: at(-2) }
    ];
    expect(projectsNeedingAttention(list, new Map(), NOW).map((x) => x.project.id)).toEqual(["b", "a", "d"]);
  });
});

describe("nearestMilestone", () => {
  const ms = (id: string, patch: Partial<Milestone>): Milestone => ({
    id, workspaceId: "ws", projectId: "p", title: id, note: "", status: "planned", startAt: null, dueAt: null, estimatedMinutes: null,
    order: 0, dependencyIds: [], blocked: false, createdAt: at(-30), updatedAt: at(-30), ...patch
  });
  it("is null with no open milestone", () => {
    expect(nearestMilestone([])).toBeNull();
    expect(nearestMilestone([ms("a", { status: "done", dueAt: at(1) })])).toBeNull();
  });
  it("takes the soonest deadline among open ones and puts undated last", () => {
    const list = [ms("late", { dueAt: at(30) }), ms("none", {}), ms("soon", { dueAt: at(3), status: "in_progress" }), ms("done", { dueAt: at(1), status: "done" })];
    expect(nearestMilestone(list)?.id).toBe("soon");
    expect(nearestMilestone([ms("b", { order: 2 }), ms("a", { order: 1 })])?.id).toBe("a");
  });
});

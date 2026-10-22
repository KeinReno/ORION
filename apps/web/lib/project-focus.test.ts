import type { Milestone, Task } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { compareTasksByFocus, groupTasksByMilestone, projectFocus } from "./project-focus";

const NOW = new Date("2026-09-20T12:00:00.000Z");

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
    checklist: [],
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

describe("compareTasksByFocus", () => {
  it("puts started work first, then the soonest deadline, then priority", () => {
    const list = [
      task("later", { dueAt: "2026-10-01T00:00:00.000Z" }),
      task("no-due-high", { priority: "high" }),
      task("started", { status: "in_progress" }),
      task("sooner", { dueAt: "2026-09-25T00:00:00.000Z" }),
      task("done", { status: "done" })
    ].sort(compareTasksByFocus);
    expect(list.map((t) => t.id)).toEqual(["started", "sooner", "later", "no-due-high", "done"]);
  });
});

describe("projectFocus", () => {
  it("splits overdue and blocked out of the next list and counts them once", () => {
    const tasks = [
      task("late", { dueAt: "2026-09-19T00:00:00.000Z" }),
      task("late-blocked", { dueAt: "2026-09-18T00:00:00.000Z", blocked: true }),
      task("waiting", { blocked: true }),
      task("free"),
      task("closed", { status: "canceled", dueAt: "2026-09-01T00:00:00.000Z" })
    ];
    const focus = projectFocus(tasks, [], NOW);
    expect(focus.overdue.map((t) => t.id)).toEqual(["late-blocked", "late"]);
    expect(focus.blocked.map((t) => t.id)).toEqual(["waiting"]);
    expect(focus.next.map((t) => t.id)).toEqual(["late", "free"]);
    expect(focus.open).toBe(4);
  });

  it("picks the first not-done milestone by order with its own task tally", () => {
    const milestones = [milestone("m2", 2), milestone("m1", 1, { status: "done" }), milestone("m3", 3)];
    const tasks = [task("a", { milestoneId: "m2" }), task("b", { milestoneId: "m2", status: "done" }), task("c")];
    const focus = projectFocus(tasks, milestones, NOW);
    expect(focus.nextMilestone?.milestone.id).toBe("m2");
    expect(focus.nextMilestone).toMatchObject({ open: 1, total: 2 });
  });

  it("caps the next list", () => {
    const tasks = Array.from({ length: 9 }, (_, i) => task(`t${i}`, { sortOrder: i }));
    expect(projectFocus(tasks, [], NOW, 3).next.map((t) => t.id)).toEqual(["t0", "t1", "t2"]);
  });
});

describe("groupTasksByMilestone", () => {
  it("orders groups by milestone, keeps empty milestones, and puts loose tasks last", () => {
    const groups = groupTasksByMilestone(
      [task("x", { milestoneId: "gone" }), task("y", { milestoneId: "m1" })],
      [milestone("m2", 2), milestone("m1", 1)],
      true
    );
    expect(groups.map((g) => g.milestone?.id ?? null)).toEqual(["m1", "m2", null]);
    expect(groups[2]?.tasks.map((t) => t.id)).toEqual(["x"]);
  });

  it("hides closed rows but still counts them", () => {
    const [group] = groupTasksByMilestone(
      [task("open"), task("done", { status: "done" })],
      [],
      false
    );
    expect(group?.tasks.map((t) => t.id)).toEqual(["open"]);
    expect(group).toMatchObject({ open: 1, closed: 1 });
  });
});

import type { Milestone, Task } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { NO_MILESTONE_KEY, buildTaskMatrix, urgencyRow } from "./project-matrix";

// Local noon on 20 Sep 2026; fixtures are built from local dates so the suite does not depend on the machine zone.
const NOW = new Date(2026, 8, 20, 12, 0);
const at = (dayOffset: number, hour = 12): string => new Date(2026, 8, 20 + dayOffset, hour, 0).toISOString();

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
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

function milestone(id: string, order: number): Milestone {
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
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
}

describe("urgencyRow", () => {
  const row = (dueAt: string | null, status: Task["status"] = "todo") => urgencyRow({ dueAt, status }, NOW);

  it("sorts open tasks by how soon they are due, counting calendar days", () => {
    expect(row(at(-1))).toBe("overdue");
    expect(row(at(0, 23))).toBe("today");
    expect(row(at(1))).toBe("week");
    expect(row(at(7))).toBe("week");
    expect(row(at(8))).toBe("later");
    expect(row(null)).toBe("none");
  });

  it("puts finished work in its own row, whatever its date was", () => {
    expect(row(at(-30), "done")).toBe("closed");
    expect(row(null, "canceled")).toBe("closed");
  });
});

describe("buildTaskMatrix", () => {
  const milestones = [milestone("m2", 2), milestone("m1", 1)];

  it("makes a column per milestone in the project's order, and 'Без вехи' only when needed", () => {
    const withLoose = buildTaskMatrix([task("a", { milestoneId: "m1" }), task("b")], milestones, false, NOW);
    expect(withLoose.columns.map((c) => c.key)).toEqual(["m1", "m2", NO_MILESTONE_KEY]);

    const noLoose = buildTaskMatrix([task("a", { milestoneId: "m1" })], milestones, false, NOW);
    expect(noLoose.columns.map((c) => c.key)).toEqual(["m1", "m2"]);
  });

  it("still gives a project without milestones one column, so its tasks have somewhere to be", () => {
    expect(buildTaskMatrix([task("a")], [], false, NOW).columns.map((c) => c.key)).toEqual([NO_MILESTONE_KEY]);
    expect(buildTaskMatrix([], [], false, NOW).columns.map((c) => c.key)).toEqual([NO_MILESTONE_KEY]);
  });

  it("treats a task pointing at an unknown milestone as having none", () => {
    const m = buildTaskMatrix([task("a", { milestoneId: "gone" })], milestones, false, NOW);
    expect(m.cells["none"]?.[NO_MILESTONE_KEY]?.map((t) => t.id)).toEqual(["a"]);
  });

  it("places tasks by column and urgency, and keeps only the rows that hold something", () => {
    const m = buildTaskMatrix(
      [
        task("late", { milestoneId: "m1", dueAt: at(-2) }),
        task("soon", { milestoneId: "m2", dueAt: at(3) }),
        task("whenever", { milestoneId: "m2" })
      ],
      milestones,
      false,
      NOW
    );
    expect(m.rows).toEqual(["overdue", "week", "none"]);
    expect(m.cells["overdue"]?.["m1"]?.map((t) => t.id)).toEqual(["late"]);
    expect(m.cells["week"]?.["m2"]?.map((t) => t.id)).toEqual(["soon"]);
    expect(m.cells["none"]?.["m2"]?.map((t) => t.id)).toEqual(["whenever"]);
  });

  it("hides closed tasks by default but counts them, so a column's tally stays true", () => {
    const tasks = [task("a", { milestoneId: "m1" }), task("b", { milestoneId: "m1", status: "done" })];
    const hidden = buildTaskMatrix(tasks, milestones, false, NOW);
    expect(hidden.rows).toEqual(["none"]);
    expect(hidden.columns.find((c) => c.key === "m1")).toMatchObject({ open: 1, closed: 1 });

    const shown = buildTaskMatrix(tasks, milestones, true, NOW);
    expect(shown.rows).toEqual(["none", "closed"]);
    expect(shown.cells["closed"]?.["m1"]?.map((t) => t.id)).toEqual(["b"]);
  });

  it("orders tasks inside a cell by work order: started first, then the earlier deadline", () => {
    const m = buildTaskMatrix(
      [
        task("later", { milestoneId: "m1", dueAt: at(5) }),
        task("sooner", { milestoneId: "m1", dueAt: at(2) }),
        task("started", { milestoneId: "m1", dueAt: at(6), status: "in_progress" })
      ],
      milestones,
      false,
      NOW
    );
    expect(m.cells["week"]?.["m1"]?.map((t) => t.id)).toEqual(["started", "sooner", "later"]);
  });
});

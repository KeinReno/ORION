import type { Milestone, Task } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { dayOffset, planDates, planGroups, timelineRange, weekTicks } from "./project-plan";

// Local noon on Sunday 20 Sep 2026; fixtures use local dates so the suite is zone-independent.
const NOW = new Date(2026, 8, 20, 12, 0);
const at = (dayOffsetFromNow: number, hour = 12): string => new Date(2026, 8, 20 + dayOffsetFromNow, hour, 0).toISOString();

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

describe("dayOffset", () => {
  it("counts local calendar days regardless of the time of day", () => {
    expect(dayOffset(new Date(2026, 8, 22, 1, 0), new Date(2026, 8, 20, 23, 59))).toBe(2);
    expect(dayOffset(new Date(2026, 8, 19, 23, 0), new Date(2026, 8, 20, 0, 5))).toBe(-1);
    expect(dayOffset(new Date(2026, 8, 20, 9), new Date(2026, 8, 20, 18))).toBe(0);
  });
});

describe("timelineRange", () => {
  it("covers every date and today, with air before and a runway after", () => {
    const r = timelineRange([new Date(2026, 8, 25), new Date(2026, 9, 10)], NOW);
    expect(r.start).toEqual(new Date(2026, 8, 17)); // 3 days before today (the earliest point)
    expect(dayOffset(new Date(2026, 9, 10), r.start)).toBeLessThan(r.days - 6); // a week of runway after the last date
  });

  it("is never narrower than the minimum, even for a single deadline", () => {
    expect(timelineRange([], NOW).days).toBeGreaterThanOrEqual(28);
    expect(timelineRange([new Date(2026, 8, 21)], NOW).days).toBeGreaterThanOrEqual(28);
  });

  it("starts at local midnight", () => {
    const r = timelineRange([new Date(2026, 8, 10, 15, 30)], NOW);
    expect([r.start.getHours(), r.start.getMinutes()]).toEqual([0, 0]);
  });
});

describe("weekTicks", () => {
  it("ticks every Monday inside the range", () => {
    const ticks = weekTicks({ start: new Date(2026, 8, 17), days: 21 }); // Thu 17 Sep …
    expect(ticks.map((t) => t.label)).toEqual(["21 сен", "28 сен", "5 окт"]);
    expect(ticks.map((t) => t.offset)).toEqual([4, 11, 18]);
  });
});

describe("planGroups", () => {
  const milestones = [milestone("m2", 2), milestone("m1", 1)];

  it("groups by milestone in the project's order and splits dated from undated", () => {
    const groups = planGroups(
      [
        task("a", { milestoneId: "m1", dueAt: at(3) }),
        task("b", { milestoneId: "m1" }),
        task("c", { milestoneId: "m2", startAt: at(1), dueAt: at(5) }),
        task("d", { dueAt: at(2) })
      ],
      milestones
    );
    expect(groups.map((g) => g.milestone?.id ?? null)).toEqual(["m1", "m2", null]);
    expect(groups[0]?.dated.map((r) => r.task.id)).toEqual(["a"]);
    expect(groups[0]?.undated.map((t) => t.id)).toEqual(["b"]);
    expect(groups[1]?.dated[0]?.start).not.toBeNull();
  });

  it("keeps an empty milestone as a group and sorts a group chronologically", () => {
    const groups = planGroups(
      [task("late", { milestoneId: "m1", dueAt: at(9) }), task("early", { milestoneId: "m1", dueAt: at(2) })],
      milestones
    );
    expect(groups.find((g) => g.milestone?.id === "m2")).toMatchObject({ dated: [], undated: [] });
    expect(groups[0]?.dated.map((r) => r.task.id)).toEqual(["early", "late"]);
  });

  it("counts open and closed tasks of a group", () => {
    const groups = planGroups([task("a", { milestoneId: "m1" }), task("b", { milestoneId: "m1", status: "done" })], milestones);
    expect(groups[0]).toMatchObject({ open: 1, closed: 1 });
  });
});

describe("planDates", () => {
  it("collects milestone and task dates, and nothing for undated work", () => {
    const groups = planGroups(
      [task("a", { milestoneId: "m1", dueAt: at(3) }), task("b", { milestoneId: "m1" })],
      [milestone("m1", 1, { startAt: at(0), dueAt: at(10) })]
    );
    expect(planDates(groups)).toHaveLength(3);
  });
});

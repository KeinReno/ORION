import { describe, expect, it } from "vitest";
import {
  compareProjectsByLifecycle,
  isProjectOverdue,
  PROJECT_STATUS_ORDER,
  projectTaskProgress,
  projectTaskRollup,
  projectTimeRollup
} from "./project";

describe("projectTaskProgress", () => {
  it("is 0 when the project has no tasks", () => {
    expect(projectTaskProgress([])).toBe(0);
  });

  it("counts canceled as closed, not as leftover work", () => {
    // 3 done + 2 canceled used to report 60% because only status === "done"
    // was counted; both are closed under isTaskClosed.
    expect(
      projectTaskProgress([
        { status: "done", count: 3 },
        { status: "canceled", count: 2 }
      ])
    ).toBe(100);
  });

  it("leaves open statuses in the remaining work", () => {
    expect(
      projectTaskProgress([
        { status: "done", count: 1 },
        { status: "canceled", count: 1 },
        { status: "todo", count: 2 }
      ])
    ).toBe(50);
  });

  it("exposes closed vs total so the UI does not reverse a rounded percent", () => {
    expect(
      projectTaskRollup([
        { status: "done", count: 1 },
        { status: "todo", count: 2 }
      ])
    ).toEqual({ taskCount: 3, closedCount: 1, progress: 33 });
  });
});

describe("compareProjectsByLifecycle", () => {
  it("orders active before on_hold before completed — not alphabetically", () => {
    expect([...PROJECT_STATUS_ORDER]).toEqual(["active", "on_hold", "completed"]);
    const rows = [
      { status: "completed", dueAt: null, name: "Z" },
      { status: "on_hold", dueAt: null, name: "M" },
      { status: "active", dueAt: null, name: "A" }
    ];
    expect(rows.sort(compareProjectsByLifecycle).map((row) => row.status)).toEqual([
      "active",
      "on_hold",
      "completed"
    ]);
  });

  it("sorts sooner due dates first and puts missing dates last", () => {
    const rows = [
      { status: "active", dueAt: "2026-09-20T00:00:00.000Z", name: "later" },
      { status: "active", dueAt: null, name: "none" },
      { status: "active", dueAt: "2026-09-12T00:00:00.000Z", name: "soon" }
    ];
    expect(rows.sort(compareProjectsByLifecycle).map((row) => row.name)).toEqual(["soon", "later", "none"]);
  });

  it("falls through to name when both due dates are missing", () => {
    // Regression: `dueTimestamp(null) - dueTimestamp(null)` is `Infinity -
    // Infinity`, which is `NaN`, not `0` — a naive `if (byDue !== 0) return
    // byDue` returns that NaN instead of falling through to the name compare,
    // leaving two same-status, dateless projects in whatever order the DB
    // query (no ORDER BY) happened to return them in.
    const rows = [
      { status: "active", dueAt: null, name: "Progress fixture" },
      { status: "active", dueAt: null, name: "A active" }
    ];
    expect(rows.sort(compareProjectsByLifecycle).map((row) => row.name)).toEqual(["A active", "Progress fixture"]);
  });
});

describe("isProjectOverdue", () => {
  const now = new Date("2026-09-12T12:00:00.000Z");

  it("flags an active project whose due date has passed", () => {
    expect(isProjectOverdue({ status: "active", dueAt: "2026-09-11T00:00:00.000Z" }, now)).toBe(true);
    expect(isProjectOverdue({ status: "on_hold", dueAt: "2026-09-11T00:00:00.000Z" }, now)).toBe(true);
  });

  it("does not flag completed work, missing dates, or future dues", () => {
    expect(isProjectOverdue({ status: "completed", dueAt: "2026-09-11T00:00:00.000Z" }, now)).toBe(false);
    expect(isProjectOverdue({ status: "active", dueAt: null }, now)).toBe(false);
    expect(isProjectOverdue({ status: "active", dueAt: "2026-09-13T00:00:00.000Z" }, now)).toBe(false);
  });
});

describe("projectTimeRollup", () => {
  it("keeps an unknown rate as null cost and parks every minute as unrated", () => {
    expect(projectTimeRollup(120, null)).toEqual({
      trackedMinutes: 120,
      timeCost: null,
      unratedMinutes: 120
    });
  });

  it("prices rated time and reports nothing unrated", () => {
    // 2 hours at 2 000 ₽/hour = 4 000 ₽ = 400_000 kopecks.
    expect(projectTimeRollup(120, 200_000)).toEqual({
      trackedMinutes: 120,
      timeCost: 400_000,
      unratedMinutes: 0
    });
  });

  it("treats an explicit zero rate as free, not unknown", () => {
    expect(projectTimeRollup(90, 0)).toEqual({ trackedMinutes: 90, timeCost: 0, unratedMinutes: 0 });
  });

  it("is empty when nothing was tracked, even without a rate", () => {
    expect(projectTimeRollup(0, null)).toEqual({ trackedMinutes: 0, timeCost: null, unratedMinutes: 0 });
  });
});

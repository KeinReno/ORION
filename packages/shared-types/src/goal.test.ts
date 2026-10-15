import { describe, expect, it } from "vitest";
import { GOAL_MAX_DEPTH, checkGoalParent, goalProgress, goalSubtreeHeight, goalTreeProgress, summarizePlanTasks, type PulseTask } from "./goal";

describe("goalTreeProgress", () => {
  const node = (id: string, parentId: string | null, plans: Array<[number, number | null]>, subWeight = 1) => ({
    id, parentId, subWeight, plans: plans.map(([weight, progress]) => ({ weight, progress }))
  });

  it("mixes direct plans and sub-goals by weight", () => {
    const r = goalTreeProgress([node("p", null, [[1, 100]]), node("c", "p", [[1, 0]], 3)]);
    expect(r.get("c")?.progress).toBe(0);
    expect(r.get("p")?.progress).toBe(25); // (1*100 + 3*0) / 4
  });

  it("leaves unknown sub-goals out and counts them, never as 0", () => {
    const r = goalTreeProgress([node("p", null, [[1, 40]]), node("c", "p", [[1, null]])]);
    expect(r.get("c")?.progress).toBeNull();
    expect(r.get("p")).toEqual({ progress: 40, unknownPlans: 0, unknownSubGoals: 1 });
  });

  it("is null when nothing below is known, through several levels", () => {
    const r = goalTreeProgress([node("a", null, []), node("b", "a", []), node("c", "b", [[1, null]])]);
    expect(r.get("a")?.progress).toBeNull();
    expect(r.get("c")).toEqual({ progress: null, unknownPlans: 1, unknownSubGoals: 0 });
  });

  it("a parent with only a known sub-goal takes its value", () => {
    const r = goalTreeProgress([node("a", null, []), node("b", "a", [[2, 60]])]);
    expect(r.get("a")?.progress).toBe(60);
  });

  it("does not loop on a corrupted cycle", () => {
    const r = goalTreeProgress([node("a", "b", [[1, 10]]), node("b", "a", [[1, 30]])]);
    expect(r.size).toBe(2);
  });
});

describe("checkGoalParent / goalSubtreeHeight", () => {
  const tree = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
    { id: "x", parentId: null }
  ];

  it("allows top-level and a valid parent", () => {
    expect(checkGoalParent("x", null, tree)).toEqual({ ok: true });
    expect(checkGoalParent("x", "a", tree)).toEqual({ ok: true });
    expect(checkGoalParent(null, "a", tree)).toEqual({ ok: true });
  });

  it("rejects self, descendants and unknown parents", () => {
    expect(checkGoalParent("a", "a", tree)).toEqual({ ok: false, reason: "self" });
    expect(checkGoalParent("a", "c", tree)).toEqual({ ok: false, reason: "cycle" });
    expect(checkGoalParent("x", "zzz", tree)).toEqual({ ok: false, reason: "missing" });
  });

  it("caps the depth at GOAL_MAX_DEPTH, counting the moved subtree", () => {
    expect(GOAL_MAX_DEPTH).toBe(3);
    expect(checkGoalParent(null, "c", tree)).toEqual({ ok: false, reason: "depth" });
    expect(checkGoalParent("x", "c", tree)).toEqual({ ok: false, reason: "depth" });
    expect(checkGoalParent("a", "x", tree)).toEqual({ ok: false, reason: "depth" });
    expect(checkGoalParent("c", "x", tree)).toEqual({ ok: true });
    expect(goalSubtreeHeight("a", tree)).toBe(3);
    expect(goalSubtreeHeight("c", tree)).toBe(1);
  });
});

describe("goalProgress", () => {
  it("is the weighted mean of plans that have progress", () => {
    expect(goalProgress([{ weight: 1, progress: 100 }, { weight: 3, progress: 20 }])).toEqual({ progress: 40, unknown: 0 });
  });

  it("leaves plans without tasks out instead of counting them as 0 %", () => {
    expect(goalProgress([{ weight: 1, progress: 50 }, { weight: 5, progress: null }])).toEqual({ progress: 50, unknown: 1 });
  });

  it("is unknown (null), not 0, when no plan has progress or there are no plans", () => {
    expect(goalProgress([{ weight: 1, progress: null }])).toEqual({ progress: null, unknown: 1 });
    expect(goalProgress([])).toEqual({ progress: null, unknown: 0 });
  });

  it("a genuine 0 % plan counts as 0", () => {
    expect(goalProgress([{ weight: 1, progress: 0 }, { weight: 1, progress: 100 }]).progress).toBe(50);
  });
});

describe("summarizePlanTasks", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const t = (id: string, patch: Partial<PulseTask> = {}): PulseTask => ({
    id,
    title: id,
    status: "todo",
    priority: "normal",
    dueAt: null,
    sortOrder: 0,
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    blocked: false,
    ...patch
  });

  it("has no next task and no activity for a project without tasks", () => {
    expect(summarizePlanTasks([], now)).toEqual({ nextTask: null, blocked: 0, overdue: 0, lastActivityAt: null });
  });

  it("prefers a started task, then the earliest due date, then priority", () => {
    const early = new Date("2026-10-20T00:00:00Z");
    const late = new Date("2026-11-20T00:00:00Z");
    expect(summarizePlanTasks([t("a", { dueAt: late }), t("b", { dueAt: early }), t("c", { status: "in_progress" })], now).nextTask?.id).toBe("c");
    expect(summarizePlanTasks([t("a", { dueAt: late }), t("b", { dueAt: early })], now).nextTask?.id).toBe("b");
    expect(summarizePlanTasks([t("a", { priority: "low" }), t("b", { priority: "high" })], now).nextTask?.id).toBe("b");
  });

  it("never points at a blocked or closed task, but counts blocked ones", () => {
    const result = summarizePlanTasks([t("a", { blocked: true }), t("b", { status: "done" })], now);
    expect(result.nextTask).toBeNull();
    expect(result.blocked).toBe(1);
  });

  it("counts overdue open tasks and flags an overdue next task", () => {
    const past = new Date("2026-10-10T00:00:00Z");
    const result = summarizePlanTasks([t("a", { dueAt: past }), t("b", { dueAt: past, status: "canceled" })], now);
    expect(result.overdue).toBe(1);
    expect(result.nextTask?.overdue).toBe(true);
  });

  it("reports the latest change across all tasks, closed included", () => {
    const result = summarizePlanTasks([t("a"), t("b", { status: "done", updatedAt: new Date("2026-10-14T08:00:00Z") })], now);
    expect(result.lastActivityAt).toBe("2026-10-14T08:00:00.000Z");
  });
});

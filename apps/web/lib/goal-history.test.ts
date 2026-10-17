import type { Goal, GoalHistory } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { buildConstellations } from "./goal-constellation";
import { goalsAt, progressDelta } from "./goal-history";
import { applyPins, clampToSky, loadPins, pinsOf } from "./goal-sky-layout";

const plan = (id: string, projectId: string, weight = 1) => ({
  id,
  projectId,
  projectName: projectId,
  projectArchived: false,
  weight,
  progress: 100,
  tasks: 4,
  closed: 4,
  nextTask: null,
  blocked: 0,
  overdue: 0,
  lastActivityAt: null,
  milestones: []
});
const goal = (id: string, patch: Partial<Goal> = {}): Goal => ({
  id,
  workspaceId: "ws",
  title: id,
  description: "",
  status: "achieved",
  dueAt: null,
  parentId: null,
  subWeight: 1,
  subGoalCount: 0,
  plans: [],
  progress: 100,
  unknownPlans: 0,
  unknownSubGoals: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
  ...patch
});
const history: GoalHistory = {
  points: ["2026-10-01T00:00:00.000Z", "2026-10-08T00:00:00.000Z", "2026-10-15T00:00:00.000Z"],
  projects: { A: [{ tasks: 0, closed: 0 }, { tasks: 4, closed: 1 }, { tasks: 4, closed: 4 }] }
};

describe("goalsAt", () => {
  const goals = [goal("g", { plans: [plan("p", "A")] })];

  it("returns the real goals for the newest point", () => {
    expect(goalsAt(goals, history, 2)).toEqual(goals);
  });

  it("rebuilds progress from the reconstructed counts, and treats an empty past as unknown, not 0", () => {
    const week = goalsAt(goals, history, 1)[0]!;
    expect(week.plans[0]).toMatchObject({ tasks: 4, closed: 1, progress: 25 });
    expect(week.progress).toBe(25);
    expect(week.status).toBe("active"); // past statuses are unknown
    const start = goalsAt(goals, history, 0)[0]!;
    expect(start.plans[0]!.progress).toBeNull();
    expect(start.progress).toBeNull();
  });

  it("leaves out goals that did not exist yet and detaches children of missing parents", () => {
    const later = goal("late", { createdAt: "2026-10-10T00:00:00.000Z" });
    const child = goal("child", { parentId: "late", createdAt: "2026-09-02T00:00:00.000Z" });
    const result = goalsAt([goal("g"), later, child], history, 1);
    expect(result.map((g) => g.id).sort()).toEqual(["child", "g"]);
    expect(result.find((g) => g.id === "child")!.parentId).toBeNull();
  });

  it("feeds the constellation builder with a dimmer past", () => {
    const past = buildConstellations(goalsAt(goals, history, 1), new Date(history.points[1]!))[0]!;
    expect(past.stars.find((s) => s.id === "g:p")!.progress).toBe(25);
  });

  it("progressDelta is null when either side is unknown", () => {
    expect(progressDelta(25, 100)).toBe(75);
    expect(progressDelta(null, 100)).toBeNull();
  });
});

describe("sky pins", () => {
  const c = buildConstellations([goal("g", { plans: [plan("p", "A")] })])[0]!;

  it("moves only pinned stars, clamped into the sky", () => {
    const moved = applyPins(c, { "g:p": { x: 9999, y: -50 } });
    const star = moved.stars.find((s) => s.id === "g:p")!;
    expect(star.x).toBe(clampToSky(9999, -50).x);
    expect(star.y).toBe(clampToSky(9999, -50).y);
    expect(moved.stars.find((s) => s.id === "g")).toEqual(c.stars.find((s) => s.id === "g"));
    expect(moved.links).toBe(c.links);
  });

  it("returns the same object when nothing is pinned here", () => {
    expect(applyPins(c, { other: { x: 1, y: 1 } })).toBe(c);
    expect(pinsOf(c, { other: { x: 1, y: 1 } })).toEqual([]);
    expect(pinsOf(c, { g: { x: 1, y: 1 } })).toEqual(["g"]);
  });

  it("loads nothing (not a crash) when storage is unavailable", () => {
    expect(loadPins("ws")).toEqual({}); // node: no window
  });
});

import type { Goal, GoalMilestone, Task } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import {
  SKY_VIEWPORT_H,
  SKY_VIEWPORT_W,
  buildConstellations,
  lensVisible,
  neighbour,
  pathToRoot,
  skyHealth,
  starAt,
  starState,
  suggestCanvasPoint,
  validParents
} from "./goal-constellation";

const NOW = new Date("2026-10-15T12:00:00Z");

function goal(id: string, patch: Partial<Goal> = {}): Goal {
  return {
    id,
    workspaceId: "ws",
    title: id,
    description: "",
    successCriteria: [],
    lastReview: null,
    status: "active",
    dueAt: null,
    parentId: null,
    subWeight: 1,
    subGoalCount: 0,
    plans: [],
    progress: null,
    unknownPlans: 0,
    unknownSubGoals: 0,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    ...patch
  };
}

const plan = (id: string, progress: number | null, weight = 1, patch: Record<string, unknown> = {}) => ({
  id,
  projectId: `p-${id}`,
  projectName: `Проект ${id}`,
  projectArchived: false,
  weight,
  progress,
  tasks: progress === null ? 0 : 4,
  closed: 0,
  nextTask: null,
  blocked: 0,
  overdue: 0,
  lastActivityAt: null,
  milestones: [] as GoalMilestone[],
  ...patch
});

const next = { id: "t1", title: "Сделать", status: "todo" as const, priority: "normal" as const, dueAt: null, overdue: false };

describe("starState", () => {
  it("keeps unknown separate from zero", () => {
    expect(starState(null, "active")).toBe("unknown");
    expect(starState(0, "active")).toBe("dim");
    expect(starState(40, "active")).toBe("lit");
    expect(starState(100, "active")).toBe("done");
  });
  it("status wins over progress", () => {
    expect(starState(10, "achieved")).toBe("done");
    expect(starState(90, "dropped")).toBe("dropped");
  });
});

describe("buildConstellations", () => {
  it("makes one constellation per top-level goal with plans and sub-goals as stars", () => {
    const goals = [
      goal("a", { plans: [plan("1", 50), plan("2", null)], progress: 50 }),
      goal("b", { parentId: "a", progress: null }),
      goal("c")
    ];
    const result = buildConstellations(goals, NOW);
    expect(result.map((c) => c.rootId)).toEqual(["a", "c"]);
    const a = result[0]!;
    expect(a.stars.map((s) => s.id).sort()).toEqual(["a", "a:1", "a:2", "b"].sort());
    expect(a.links).toHaveLength(3);
    expect(a.links.find((l) => l.to === "a:1")?.lit).toBe(true);
    expect(a.links.find((l) => l.to === "a:2")?.lit).toBe(false);
  });

  it("keeps sparse layouts composed and grows the world for dense trees", () => {
    const goals = [
      goal("root", { plans: [plan("1", 10), plan("2", 90), plan("3", 0), plan("4", null)] }),
      goal("s1", { parentId: "root", plans: [plan("5", 30)] }),
      goal("s2", { parentId: "s1", plans: [plan("6", 100), plan("7", 20)] })
    ];
    for (const star of buildConstellations(goals, NOW)[0]!.stars) {
      expect(Number.isFinite(star.x)).toBe(true);
      expect(Number.isFinite(star.y)).toBe(true);
    }
    const many = Array.from({ length: 100 }, (_, index) => goal(`child-${index}`, { parentId: "root" }));
    const dense = buildConstellations([goal("root"), ...many], NOW)[0]!;
    const leaves = dense.stars.filter((star) => star.parentId === "root").sort((a, b) => a.x - b.x);
    expect(leaves).toHaveLength(100);
    expect(leaves[99]!.x - leaves[0]!.x).toBeGreaterThan(SKY_VIEWPORT_W);
    expect(Math.min(...leaves.map((star) => star.y))).toBeGreaterThan(0);
    expect(SKY_VIEWPORT_H).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const goals = [goal("a", { plans: [plan("1", 50), plan("2", 20)] })];
    expect(buildConstellations(goals, NOW)).toEqual(buildConstellations(goals, NOW));
  });

  it("places the outcome above its branches and centres a parent over its children", () => {
    const c = buildConstellations([goal("a", { plans: [plan("1", 10), plan("2", 20)] })], NOW)[0]!;
    const root = c.stars.find((s) => s.id === "a")!;
    const left = c.stars.find((s) => s.id === "a:1")!;
    const right = c.stars.find((s) => s.id === "a:2")!;
    expect(root.y).toBeLessThan(left.y);
    expect(left.y).toBe(right.y);
    expect(left.x).toBeLessThan(root.x);
    expect(root.x).toBeLessThan(right.x);
  });

  it("shows an orphaned sub-goal as its own constellation and survives a cycle", () => {
    const orphan = buildConstellations([goal("x", { parentId: "gone" })]);
    expect(orphan.map((c) => c.rootId)).toEqual(["x"]);
    const cyc = buildConstellations([goal("p", { parentId: "q" }), goal("q", { parentId: "p" })]);
    expect(cyc).toEqual([]); // no root at all: nothing to hang on, but no infinite loop either
  });

  it("gives heavier plans bigger stars", () => {
    const stars = buildConstellations([goal("a", { plans: [plan("1", 10, 9), plan("2", 10, 1)] })])[0]!.stars;
    expect(stars.find((s) => s.id === "a:1")!.r).toBeGreaterThan(stars.find((s) => s.id === "a:2")!.r);
  });

  it("places a real project task under its milestone and keeps the goal progress from the server", () => {
    const milestone = { id: "m1", title: "Первый этап", status: "planned" as const, dueAt: null, tasks: 1, closed: 0 };
    const task: Task = {
      id: "t1", revision: 1, workspaceId: "ws", projectId: "p-1", parentId: null,
      title: "Разметить грядки", description: "", status: "todo", priority: "normal", dueAt: null,
      projectTag: null, recurrence: null, completedAt: null, sortOrder: 0, dependencyIds: [], blocked: false,
      assigneeId: null, startAt: null, estimatedMinutes: null, milestoneId: "m1", checklist: [],
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString()
    };
    const constellation = buildConstellations([goal("garden", { plans: [plan("1", 0, 1, { milestones: [milestone] })], progress: 0 })], NOW, [task])[0]!;
    const milestoneStar = constellation.stars.find((star) => star.milestoneId === "m1" && star.kind === "milestone")!;
    const taskStar = constellation.stars.find((star) => star.taskId === "t1")!;
    expect(taskStar.parentId).toBe(milestoneStar.id);
    expect(taskStar.kind).toBe("task");
    expect(constellation.stars.find((star) => star.id === "garden")?.progress).toBe(0);
  });

  it("suggests a new location away from existing stars and their labels", () => {
    const constellation = buildConstellations([goal("garden", { plans: [plan("1", 0)] })], NOW)[0]!;
    const planStar = constellation.stars.find((star) => star.kind === "plan")!;
    const first = suggestCanvasPoint(constellation.stars, planStar);
    const occupied = { ...planStar, id: "occupied", x: first.x, y: first.y };
    const second = suggestCanvasPoint([...constellation.stars, occupied], occupied);
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(80);
  });
});

describe("pathToRoot", () => {
  it("returns the route from the goal down to a plan", () => {
    const goals = [goal("a"), goal("b", { parentId: "a", plans: [plan("1", 10)] })];
    const c = buildConstellations(goals, NOW)[0]!;
    expect(pathToRoot(c, "b:1")).toEqual(["a", "b", "b:1"]);
    expect(pathToRoot(c, "nope")).toEqual([]);
  });
});

describe("facts, lenses and health", () => {
  const goals = [
    goal("g", { progress: 30, plans: [
      plan("ok", 50, 1, { nextTask: next, lastActivityAt: "2026-10-14T00:00:00Z" }),
      plan("old", 20, 1, { nextTask: next, lastActivityAt: "2026-09-01T00:00:00Z" }),
      plan("late", 10, 1, { overdue: 2 }),
      plan("none", null)
    ] })
  ];
  const c = buildConstellations(goals, NOW)[0]!;
  const star = (id: string) => c.stars.find((s) => s.id === id)!;

  it("marks the next step, and a plan that has not moved for two weeks", () => {
    expect(star("g:ok").frontier).toBe(true);
    expect(star("g:ok").stalled).toBe(false);
    expect(star("g:old").stalled).toBe(true);
    expect(star("g:none").frontier).toBe(false);
    expect(star("g:none").stalled).toBe(false); // no open work is not "стоит"
  });

  it("does not light a frontier under a dropped goal", () => {
    const dropped = buildConstellations([goal("d", { status: "dropped", plans: [plan("1", 10, 1, { nextTask: next })] })], NOW)[0]!;
    expect(dropped.stars.find((s) => s.id === "d:1")!.frontier).toBe(false);
  });

  it("focus keeps the routes to next steps, stuck keeps the routes to trouble", () => {
    expect([...lensVisible(c, "focus")!].sort()).toEqual(["g", "g:ok", "g:old"]);
    expect([...lensVisible(c, "stuck")!].sort()).toEqual(["g", "g:late", "g:old"]);
    expect(lensVisible(c, "progress")).toBeNull();
  });

  it("does not fade a goal when no next step or blocker exists", () => {
    const empty = buildConstellations([goal("empty")], NOW)[0]!;
    expect(lensVisible(empty, "focus")).toBeNull();
    expect(lensVisible(empty, "stuck")).toBeNull();
  });

  it("summarises health for the overview card", () => {
    const health = skyHealth(c);
    expect(health.tone).toBe("attention");
    expect(health).toMatchObject({ overdue: 2, blocked: 0, stalled: 1 });
    expect(health.next?.id).toBe("g:ok");
    expect(skyHealth(buildConstellations([goal("x", { progress: 100 })], NOW)[0]!).tone).toBe("done");
    expect(skyHealth(buildConstellations([goal("y")], NOW)[0]!).tone).toBe("idle");
  });
});

describe("drag and keyboard helpers", () => {
  const goals = [goal("a"), goal("b", { parentId: "a" }), goal("c", { parentId: "b" }), goal("z")];

  it("offers only legal parents", () => {
    expect([...validParents(goals, "a")]).toEqual([]); // not itself, not its own subtree, and a-b-c is already 3 levels deep
    expect([...validParents(goals, "z")].sort()).toEqual(["a", "b"]); // c would be a 4th level
    expect([...validParents(goals, null)].sort()).toEqual(["a", "b", "z"]);
  });

  it("finds the star under a point and honours the filter", () => {
    const c = buildConstellations([goal("a", { plans: [plan("1", 10)] })], NOW)[0]!;
    const root = c.stars[0]!;
    expect(starAt(c.stars, root.x + 2, root.y)?.id).toBe("a");
    expect(starAt(c.stars, root.x, root.y, 10, (s) => s.kind === "plan")).toBeNull();
    expect(starAt(c.stars, -500, -500)).toBeNull();
  });

  it("travels along the tree with the arrow keys", () => {
    const c = buildConstellations([goal("a", { plans: [plan("1", 10), plan("2", 10)] })], NOW)[0]!;
    expect(neighbour(c, "a", "down")).toBe("a:1");
    expect(neighbour(c, "a:1", "up")).toBe("a");
    expect(neighbour(c, "a:1", "right")).toBe("a:2");
    expect(neighbour(c, "a:1", "left")).toBe("a:2"); // wraps
    expect(neighbour(c, "a", "up")).toBeNull();
  });
});

const ms = (id: string, status: GoalMilestone["status"], patch: Partial<GoalMilestone> = {}): GoalMilestone => ({
  id,
  title: `Веха ${id}`,
  status,
  dueAt: null,
  tasks: 0,
  closed: 0,
  ...patch
});

describe("milestones as a path", () => {
  const goals = [
    goal("g", {
      plans: [plan("p", 40, 1, { nextTask: next, milestones: [ms("m1", "done"), ms("m2", "in_progress", { tasks: 4, closed: 1 }), ms("m3", "planned")] })]
    })
  ];
  const c = buildConstellations(goals, NOW)[0]!;
  const star = (id: string) => c.stars.find((s) => s.id === id)!;

  it("hangs the milestones one after another on the plan's branch", () => {
    expect(c.stars.map((s) => s.id)).toEqual(["g", "g:p", "g:p:m3", "g:p:m2", "g:p:m1"]);
    expect(pathToRoot(c, "g:p:m1")).toEqual(["g", "g:p", "g:p:m3", "g:p:m2", "g:p:m1"]);
    expect(star("g:p:m1").y).toBeGreaterThan(star("g:p:m3").y);
    expect(star("g:p:m1").state).toBe("done");
    expect(star("g:p:m2")).toMatchObject({ progress: 25, state: "lit" });
    expect(star("g:p:m3").state).toBe("unknown"); // a milestone without tasks is unknown, not 0
  });

  it("pulses the first unfinished milestone instead of the plan", () => {
    expect(star("g:p").ready).toBe(true);
    expect(star("g:p").frontier).toBe(false);
    expect(star("g:p:m2").frontier).toBe(true);
    expect(star("g:p:m3").frontier).toBe(false);
    expect(skyHealth(c).next?.id).toBe("g:p"); // the card still names the plan's next task
  });

  it("falls back to pulsing the plan when the route is finished", () => {
    const done = buildConstellations([goal("g", { plans: [plan("p", 60, 1, { nextTask: next, milestones: [ms("m1", "done")] })] })], NOW)[0]!;
    expect(done.stars.find((s) => s.id === "g:p")!.frontier).toBe(true);
  });

  it("counts an overdue unfinished milestone as trouble", () => {
    const late = buildConstellations(
      [goal("g", { progress: 10, plans: [plan("p", 10, 1, { milestones: [ms("m1", "planned", { dueAt: "2026-10-01T00:00:00Z" })] })] })],
      NOW
    )[0]!;
    expect(late.stars.find((s) => s.kind === "milestone")!.overdue).toBe(1);
    expect(skyHealth(late)).toMatchObject({ overdue: 1, tone: "attention" });
  });

  it("draws only a window of a long route", () => {
    const many = Array.from({ length: 8 }, (_, i) => ms(`m${i}`, i < 5 ? "done" : "planned"));
    const long = buildConstellations([goal("g", { plans: [plan("p", 50, 1, { milestones: many })] })], NOW)[0]!;
    expect(long.stars.filter((s) => s.kind === "milestone").map((s) => s.milestoneId)).toEqual(["m7", "m6", "m5", "m4"]);
  });
});

describe("pace and shared projects", () => {
  it("puts the deadline pace on the goal star and into the card health", () => {
    const behind = buildConstellations(
      [goal("g", { progress: 10, createdAt: "2026-10-01T00:00:00Z", dueAt: "2026-10-29T00:00:00Z", plans: [plan("p", 10)] })],
      NOW
    )[0]!;
    expect(behind.stars[0]!.pace.state).toBe("behind");
    expect(skyHealth(behind)).toMatchObject({ tone: "attention", pace: { state: "behind" } });
    expect(behind.stars.find((s) => s.kind === "plan")!.pace.state).toBe("none");
  });

  it("marks a project that serves two goals on both", () => {
    const shared = plan("p", 10);
    const [a, b] = buildConstellations(
      [goal("a", { plans: [{ ...shared, id: "pa", projectId: "P" }] }), goal("b", { plans: [{ ...shared, id: "pb", projectId: "P" }] }), goal("c", { plans: [plan("x", 1)] })],
      NOW
    );
    expect(a!.stars.find((s) => s.kind === "plan")!.sharedWith).toEqual(["b"]);
    expect(b!.stars.find((s) => s.kind === "plan")!.sharedWith).toEqual(["a"]);
    expect(skyHealth(a!).shared).toBe(1);
  });
});

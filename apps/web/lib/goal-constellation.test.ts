import type { Goal } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import {
  CONSTELLATION_H,
  CONSTELLATION_W,
  buildConstellations,
  lensVisible,
  neighbour,
  pathToRoot,
  skyHealth,
  starAt,
  starState,
  validParents
} from "./goal-constellation";

const NOW = new Date("2026-10-15T12:00:00Z");

function goal(id: string, patch: Partial<Goal> = {}): Goal {
  return {
    id,
    workspaceId: "ws",
    title: id,
    description: "",
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

  it("keeps every star inside the canvas", () => {
    const goals = [
      goal("root", { plans: [plan("1", 10), plan("2", 90), plan("3", 0), plan("4", null)] }),
      goal("s1", { parentId: "root", plans: [plan("5", 30)] }),
      goal("s2", { parentId: "s1", plans: [plan("6", 100), plan("7", 20)] })
    ];
    for (const star of buildConstellations(goals, NOW)[0]!.stars) {
      expect(star.x).toBeGreaterThan(0);
      expect(star.x).toBeLessThan(CONSTELLATION_W);
      expect(star.y).toBeGreaterThan(0);
      expect(star.y).toBeLessThan(CONSTELLATION_H);
    }
  });

  it("is deterministic", () => {
    const goals = [goal("a", { plans: [plan("1", 50), plan("2", 20)] })];
    expect(buildConstellations(goals, NOW)).toEqual(buildConstellations(goals, NOW));
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

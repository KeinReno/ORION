import { describe, expect, it } from "vitest";
import {
  autoLayoutGoalCanvas,
  goalCanvasDependencyLayers,
  goalCanvasKey,
  mergeGoalCanvasEntries,
  type GoalCanvasEntry,
  type GoalCanvasLayoutNode
} from "./goal-canvas";

const NOW = "2026-11-11T10:00:00.000Z";

function entry(entityId: string, x: number, y: number, updatedAt = "2026-11-11T09:00:00.000Z"): GoalCanvasEntry {
  return { entityType: "task", entityId, x, y, updatedAt };
}

function node(entityType: GoalCanvasLayoutNode["entityType"], entityId: string, order = 0): GoalCanvasLayoutNode {
  return { entityType, entityId, title: entityId, order };
}

describe("mergeGoalCanvasEntries (08.1 per-node merge)", () => {
  it("keeps edits of two different nodes from two clients", () => {
    const first = mergeGoalCanvasEntries([], [entry("a", 10, 20)], NOW);
    const second = mergeGoalCanvasEntries(first.entries, [entry("b", 30, 40)], NOW);
    expect(second.conflicts).toEqual([]);
    expect(second.entries.map((item) => [item.entityId, item.x, item.y])).toEqual([
      ["a", 10, 20],
      ["b", 30, 40]
    ]);
  });

  it("lets the newest stamp win on the same node without a conflict", () => {
    const stored = [entry("a", 0, 0, "2026-11-11T09:00:00.000Z")];
    const result = mergeGoalCanvasEntries(stored, [entry("a", 50, 60, "2026-11-11T09:30:00.000Z")], NOW);
    expect(result.conflicts).toEqual([]);
    expect(result.entries[0]).toMatchObject({ x: 50, y: 60 });
  });

  it("returns BOTH versions when a stale write loses instead of dropping it", () => {
    const stored = [entry("a", 50, 60, "2026-11-11T09:30:00.000Z")];
    const result = mergeGoalCanvasEntries(stored, [entry("a", 1, 2, "2026-11-11T09:00:00.000Z")], NOW);
    expect(result.entries[0]).toMatchObject({ x: 50, y: 60 });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      entityType: "task",
      entityId: "a",
      reason: "stale",
      client: { x: 1, y: 2 },
      server: { x: 50, y: 60 }
    });
  });

  it("marks an equal stamp with different coordinates as ambiguous", () => {
    const stored = [entry("a", 50, 60)];
    const result = mergeGoalCanvasEntries(stored, [entry("a", 1, 2)], NOW);
    expect(result.conflicts[0]?.reason).toBe("ambiguous");
    expect(result.entries[0]).toMatchObject({ x: 50, y: 60 });
  });

  it("fills a missing updatedAt from the request time", () => {
    const result = mergeGoalCanvasEntries([], [{ entityType: "goal", entityId: "g", x: 1, y: 2 }], NOW);
    expect(result.entries[0]?.updatedAt).toBe(NOW);
  });
});

describe("goalCanvasDependencyLayers (08.3 topological layers)", () => {
  it("puts every depends_on source strictly above its target", () => {
    const nodes = [node("goal", "root"), node("project", "p"), node("task", "t1"), node("task", "t2")];
    const edges = [
      { source: goalCanvasKey("goal", "root"), target: goalCanvasKey("project", "p") },
      { source: goalCanvasKey("project", "p"), target: goalCanvasKey("task", "t1") },
      { source: goalCanvasKey("task", "t1"), target: goalCanvasKey("task", "t2") }
    ];
    const layers = goalCanvasDependencyLayers(nodes, edges);
    expect(layers.get(goalCanvasKey("goal", "root"))).toBe(0);
    expect(layers.get(goalCanvasKey("project", "p"))).toBe(1);
    expect(layers.get(goalCanvasKey("task", "t1"))).toBe(2);
    expect(layers.get(goalCanvasKey("task", "t2"))).toBe(3);
  });

  it("keeps every node when the graph contains a cycle", () => {
    const nodes = [node("task", "a"), node("task", "b")];
    const edges = [
      { source: goalCanvasKey("task", "a"), target: goalCanvasKey("task", "b") },
      { source: goalCanvasKey("task", "b"), target: goalCanvasKey("task", "a") }
    ];
    const layers = goalCanvasDependencyLayers(nodes, edges);
    expect(layers.size).toBe(2);
  });
});

describe("autoLayoutGoalCanvas (08.3)", () => {
  const nodes = [node("goal", "g", 0), node("project", "p", 0), node("task", "t1", 1), node("task", "t2", 2)];
  const edges = [
    { source: goalCanvasKey("goal", "g"), target: goalCanvasKey("project", "p") },
    { source: goalCanvasKey("project", "p"), target: goalCanvasKey("task", "t1") },
    { source: goalCanvasKey("project", "p"), target: goalCanvasKey("task", "t2") }
  ];

  it("is deterministic and never puts a dependent node above its prerequisite", () => {
    const first = autoLayoutGoalCanvas(nodes, edges, { nowIso: NOW });
    const second = autoLayoutGoalCanvas(nodes, edges, { nowIso: NOW });
    expect(second).toEqual(first);
    const byKey = new Map(first.entries.map((item) => [goalCanvasKey(item.entityType, item.entityId), item]));
    for (const edge of edges) {
      expect(byKey.get(edge.target)!.y).toBeGreaterThan(byKey.get(edge.source)!.y);
    }
  });

  it("does not move a manual anchor and keeps generated nodes clear of it", () => {
    const manual: GoalCanvasEntry = { entityType: "project", entityId: "p", x: 0, y: 268, dirty: true, updatedAt: NOW };
    const result = autoLayoutGoalCanvas(nodes, edges, { nowIso: NOW, respectManual: true, manual: [manual] });
    const project = result.entries.find((item) => item.entityId === "p")!;
    expect(project).toMatchObject({ x: 0, y: 268, dirty: true });
    const task = result.entries.find((item) => item.entityId === "t1")!;
    const overlaps = Math.abs(task.x - project.x) < 160 && Math.abs(task.y - project.y) < 100;
    expect(overlaps).toBe(false);
  });

  it("moves a manual node when respectManual is off", () => {
    const manual: GoalCanvasEntry = { entityType: "project", entityId: "p", x: 999, y: -999, dirty: true, updatedAt: NOW };
    const result = autoLayoutGoalCanvas(nodes, edges, { nowIso: NOW, respectManual: false, manual: [manual] });
    const project = result.entries.find((item) => item.entityId === "p")!;
    expect(project.x).not.toBe(999);
  });

  it("keeps layout nodes that are not part of the graph", () => {
    const foreign: GoalCanvasEntry = { entityType: "material", entityId: "doc-1", x: 5, y: 6, updatedAt: NOW };
    const result = autoLayoutGoalCanvas(nodes, edges, { nowIso: NOW, manual: [foreign] });
    expect(result.entries.find((item) => item.entityId === "doc-1")).toMatchObject({ x: 5, y: 6 });
  });
});

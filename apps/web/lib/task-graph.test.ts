import type { Task } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { buildTaskTree, flattenTree, layoutDependencyGraph, openBlockers } from "./task-graph";

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

describe("openBlockers", () => {
  it("counts only open prerequisites that are known", () => {
    const tasks = [
      task("a", { status: "done" }),
      task("b"),
      task("c", { dependencyIds: ["a", "b", "outside"] }),
      task("d", { status: "done", dependencyIds: ["b"] })
    ];
    const blockers = openBlockers(tasks);
    expect(blockers.get("c")?.map((t) => t.id)).toEqual(["b"]);
    expect(blockers.has("d")).toBe(false); // a closed task is not "blocked"
    expect(blockers.has("a")).toBe(false);
  });
});

describe("buildTaskTree", () => {
  const tasks = [
    task("root", { sortOrder: 1 }),
    task("kid2", { parentId: "root", sortOrder: 2 }),
    task("kid1", { parentId: "root", sortOrder: 1 }),
    task("grand", { parentId: "kid1" }),
    task("orphan", { parentId: "elsewhere", sortOrder: 5 })
  ];

  it("nests by parentId, orders by sortOrder, and roots tasks whose parent is not in the set", () => {
    const tree = buildTaskTree(tasks, true);
    expect(tree.map((n) => n.task.id)).toEqual(["root", "orphan"]);
    expect(tree[0].children.map((n) => n.task.id)).toEqual(["kid1", "kid2"]);
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });

  it("hides closed leaves but keeps a closed parent that still has open children", () => {
    const withClosed = [
      task("p", { status: "done" }),
      task("c", { parentId: "p" }),
      task("lonely", { status: "done" })
    ];
    const tree = buildTaskTree(withClosed, false);
    expect(tree.map((n) => n.task.id)).toEqual(["p"]);
    expect(buildTaskTree(withClosed, true).map((n) => n.task.id).sort()).toEqual(["lonely", "p"]);
  });

  it("counts subtasks before hiding closed ones", () => {
    const tree = buildTaskTree([task("p"), task("c1", { parentId: "p", status: "done" }), task("c2", { parentId: "p" })], false);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0]).toMatchObject({ childTotal: 2, childClosed: 1 });
  });

  it("survives a parent cycle in bad data", () => {
    const cyclic = [task("x", { parentId: "y" }), task("y", { parentId: "x" })];
    expect(() => buildTaskTree(cyclic, true)).not.toThrow();
  });

  it("flattenTree skips collapsed subtrees", () => {
    const rows = flattenTree(buildTaskTree(tasks, true), new Set(["kid1"]));
    expect(rows.map((n) => n.task.id)).toEqual(["root", "kid1", "kid2", "orphan"]);
  });
});

describe("layoutDependencyGraph", () => {
  it("puts a task one column right of its deepest prerequisite and skips isolated tasks", () => {
    const tasks = [
      task("a"),
      task("b", { dependencyIds: ["a"] }),
      task("c", { dependencyIds: ["a", "b"] }),
      task("alone")
    ];
    const graph = layoutDependencyGraph(tasks, true);
    const layer = Object.fromEntries(graph.nodes.map((n) => [n.task.id, n.layer]));
    expect(layer).toEqual({ a: 0, b: 1, c: 2 });
    expect(graph.edges).toHaveLength(3);
    expect(graph.nodes.find((n) => n.task.id === "c")?.blocked).toBe(true);
    expect(graph.width).toBeGreaterThan(0);
  });

  it("marks edges from closed prerequisites as non-blocking and can hide fully closed chains", () => {
    const tasks = [task("a", { status: "done" }), task("b", { dependencyIds: ["a"] }), task("x", { status: "done" }), task("y", { status: "done", dependencyIds: ["x"] })];
    const shown = layoutDependencyGraph(tasks, false);
    expect(shown.edges.map((e) => `${e.from}>${e.to}:${e.blocking}`)).toEqual(["a>b:false"]);
    expect(layoutDependencyGraph(tasks, true).edges).toHaveLength(2);
  });

  it("does not loop on a dependency cycle and reports it", () => {
    const tasks = [task("a", { dependencyIds: ["b"] }), task("b", { dependencyIds: ["a"] })];
    const graph = layoutDependencyGraph(tasks, true);
    expect(graph.cyclic.length).toBeGreaterThan(0);
    expect(graph.nodes).toHaveLength(2);
  });

  it("is empty when nothing depends on anything", () => {
    const graph = layoutDependencyGraph([task("a"), task("b")], true);
    expect(graph.nodes).toEqual([]);
    expect(graph.width).toBe(0);
  });
});

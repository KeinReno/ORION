import { describe, expect, it } from "vitest";
import { criticalPath, type CriticalPathNode } from "./gantt-critical-path";

const d = (iso: string): Date => new Date(iso);

function task(id: string, patch: Partial<CriticalPathNode> = {}): CriticalPathNode {
  return { kind: "task", id, dependencyIds: [], startAt: null, dueAt: null, ...patch };
}

describe("criticalPath", () => {
  it("walks the single chain that ends at the latest-finishing row", () => {
    const rows: CriticalPathNode[] = [
      task("a", { dueAt: d("2026-01-05") }),
      task("b", { dueAt: d("2026-01-10"), dependencyIds: ["a"] }),
      task("c", { dueAt: d("2026-01-20"), dependencyIds: ["b"] })
    ];
    expect(criticalPath(rows)).toEqual(new Set(["task:a", "task:b", "task:c"]));
  });

  it("at a fork, follows whichever dependency itself finishes latest — the one that could have delayed the sink", () => {
    const rows: CriticalPathNode[] = [
      task("early", { dueAt: d("2026-01-02") }),
      task("late", { dueAt: d("2026-01-08") }),
      task("sink", { dueAt: d("2026-01-20"), dependencyIds: ["early", "late"] })
    ];
    expect(criticalPath(rows)).toEqual(new Set(["task:sink", "task:late"]));
  });

  it("a row off the critical chain (not an ancestor of the sink) is not included", () => {
    const rows: CriticalPathNode[] = [
      task("a", { dueAt: d("2026-01-05") }),
      task("sink", { dueAt: d("2026-01-20"), dependencyIds: ["a"] }),
      task("unrelated", { dueAt: d("2026-01-15") })
    ];
    const path = criticalPath(rows);
    expect(path).toEqual(new Set(["task:sink", "task:a"]));
    expect(path.has("task:unrelated")).toBe(false);
  });

  it("stops at a row with no dated dependency and never loops on a cycle", () => {
    const rows: CriticalPathNode[] = [
      task("a", { dueAt: d("2026-01-05") }),
      task("b", { dueAt: d("2026-01-10"), dependencyIds: ["a"] })
    ];
    expect(criticalPath(rows)).toEqual(new Set(["task:a", "task:b"]));

    // A cycle (data the server should already refuse, but the UI helper must not hang on it).
    const cyclic: CriticalPathNode[] = [
      task("x", { dueAt: d("2026-01-05"), dependencyIds: ["y"] }),
      task("y", { dueAt: d("2026-01-01"), dependencyIds: ["x"] })
    ];
    expect(() => criticalPath(cyclic)).not.toThrow();
  });

  it("milestones and tasks are independent graphs — a task never appears on the milestone path or vice versa", () => {
    const rows: CriticalPathNode[] = [
      { kind: "milestone", id: "m1", dependencyIds: [], startAt: null, dueAt: d("2026-02-01") },
      { kind: "milestone", id: "m2", dependencyIds: ["m1"], startAt: null, dueAt: d("2026-03-01") },
      task("t1", { dueAt: d("2026-01-10") }),
      task("t2", { dueAt: d("2026-01-20"), dependencyIds: ["t1"] })
    ];
    const path = criticalPath(rows);
    expect(path).toEqual(new Set(["milestone:m2", "milestone:m1", "task:t2", "task:t1"]));
  });

  it("no dated rows of a kind — nothing crashes, nothing is marked critical", () => {
    expect(criticalPath([])).toEqual(new Set());
    expect(criticalPath([task("a")])).toEqual(new Set());
  });
});

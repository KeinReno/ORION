import { describe, expect, it } from "vitest";
import {
  canonicalizeEndpoints,
  isRelationPairAllowed,
  RELATION_CYCLE_KINDS,
  RELATION_KIND_CATALOG,
  wouldCreateRelationCycle,
  type RelationEdge
} from "./search";

const node = (type: "task" | "note" | "goal" | "project", id: string) => ({ type, id });

describe("Foundation Core relation kinds", () => {
  it("catalog values are a closed list and include the universal kinds", () => {
    expect(RELATION_KIND_CATALOG.blocks.symmetric).toBe(false);
    expect(RELATION_KIND_CATALOG.depends_on.symmetric).toBe(false);
    expect(RELATION_KIND_CATALOG.relates_to.symmetric).toBe(true);
    expect([...RELATION_CYCLE_KINDS]).toEqual(expect.arrayContaining(["depends_on", "blocks", "goal_prerequisite"]));
  });

  it("allows same-type links for the universal kinds but not for the legacy related_to", () => {
    expect(isRelationPairAllowed("depends_on", "task", "task")).toBe(true);
    expect(isRelationPairAllowed("references", "note", "note")).toBe(true);
    expect(isRelationPairAllowed("related_to", "task", "task")).toBe(false);
  });

  it("canonicalizes only symmetric kinds", () => {
    const a = node("task", "a");
    const b = node("goal", "b");
    // Canonical order is lexicographic by `type:id`; "goal:b" < "task:a".
    expect(canonicalizeEndpoints("relates_to", a, b)).toEqual({ source: b, target: a });
    expect(canonicalizeEndpoints("relates_to", b, a)).toEqual({ source: b, target: a });
    expect(canonicalizeEndpoints("depends_on", b, a)).toEqual({ source: b, target: a });
  });

  it("detects a cycle when the target already reaches the source", () => {
    const edges: RelationEdge[] = [
      { source: node("task", "a"), target: node("task", "b") },
      { source: node("task", "b"), target: node("task", "c") }
    ];
    expect(wouldCreateRelationCycle(edges, node("task", "c"), node("task", "a"))).toBe(true);
    expect(wouldCreateRelationCycle(edges, node("task", "a"), node("task", "c"))).toBe(false);
    // A self-edge is always a cycle.
    expect(wouldCreateRelationCycle([], node("task", "a"), node("task", "a"))).toBe(true);
  });

  it("does not confuse entities of different types with the same id", () => {
    const edges: RelationEdge[] = [{ source: node("task", "x"), target: node("note", "y") }];
    expect(wouldCreateRelationCycle(edges, node("goal", "y"), node("task", "x"))).toBe(false);
  });
});

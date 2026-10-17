import { describe, expect, it } from "vitest";
import { canonicalizeEndpoints, createEntityLinkInputSchema, isRelationPairAllowed, RELATION_KIND_CATALOG } from "./search";

describe("RELATION_KIND_CATALOG (U01)", () => {
  it("related_to is symmetric and allows any pair of distinct types", () => {
    expect(RELATION_KIND_CATALOG.related_to.symmetric).toBe(true);
    expect(isRelationPairAllowed("related_to", "task", "note")).toBe(true);
    expect(isRelationPairAllowed("related_to", "note", "task")).toBe(true);
    expect(isRelationPairAllowed("related_to", "task", "task")).toBe(false); // same type still needs distinct ids elsewhere; the catalog itself rejects identical types
  });

  it("supports is directed: note/document -> task only, not the reverse and not other pairs", () => {
    expect(isRelationPairAllowed("supports", "note", "task")).toBe(true);
    expect(isRelationPairAllowed("supports", "document", "task")).toBe(true);
    expect(isRelationPairAllowed("supports", "task", "note")).toBe(false);
    expect(isRelationPairAllowed("supports", "task", "document")).toBe(false);
    expect(isRelationPairAllowed("supports", "note", "document")).toBe(false);
  });

  it("evidence_for is directed: document -> transaction only", () => {
    expect(isRelationPairAllowed("evidence_for", "document", "transaction")).toBe(true);
    expect(isRelationPairAllowed("evidence_for", "transaction", "document")).toBe(false);
    expect(isRelationPairAllowed("evidence_for", "note", "transaction")).toBe(false);
  });

  it("goal roles point from the live source to a goal and keep their intended types", () => {
    expect(isRelationPairAllowed("goal_step", "task", "goal")).toBe(true);
    expect(isRelationPairAllowed("goal_step", "goal", "task")).toBe(false);
    expect(isRelationPairAllowed("goal_measure", "account", "goal")).toBe(true);
    expect(isRelationPairAllowed("goal_measure", "savings_goal", "goal")).toBe(true);
    expect(isRelationPairAllowed("goal_measure", "note", "goal")).toBe(false);
    expect(isRelationPairAllowed("goal_material", "document", "goal")).toBe(true);
    expect(isRelationPairAllowed("goal_risk", "transaction", "goal")).toBe(true);
    expect(isRelationPairAllowed("goal_prerequisite", "goal", "goal")).toBe(true);
    expect(createEntityLinkInputSchema.safeParse({ sourceType: "goal", sourceId: "a", targetType: "goal", targetId: "a", kind: "goal_prerequisite" }).success).toBe(false);
  });
});

describe("canonicalizeEndpoints (U01 symmetric normalization)", () => {
  it("sorts a symmetric pair into a stable order regardless of call direction", () => {
    const a = { type: "task" as const, id: "aaa" };
    const b = { type: "note" as const, id: "bbb" };
    const forward = canonicalizeEndpoints("related_to", a, b);
    const reverse = canonicalizeEndpoints("related_to", b, a);
    expect(forward).toEqual(reverse);
  });

  it("leaves a directed kind's endpoints untouched — task supports project is not the same fact as project supports task", () => {
    const source = { type: "note" as const, id: "n1" };
    const target = { type: "task" as const, id: "t1" };
    expect(canonicalizeEndpoints("supports", source, target)).toEqual({ source, target });
  });
});

describe("createEntityLinkInputSchema self-link guard", () => {
  it("rejects the same type + same id", () => {
    const result = createEntityLinkInputSchema.safeParse({
      sourceType: "task",
      sourceId: "x",
      targetType: "task",
      targetId: "x",
      kind: "related_to"
    });
    expect(result.success).toBe(false);
  });

  it("accepts the same type with different ids", () => {
    const result = createEntityLinkInputSchema.safeParse({
      sourceType: "task",
      sourceId: "x",
      targetType: "task",
      targetId: "y",
      kind: "related_to"
    });
    expect(result.success).toBe(true);
  });

  it("defaults kind to related_to when omitted", () => {
    const result = createEntityLinkInputSchema.parse({
      sourceType: "task",
      sourceId: "x",
      targetType: "note",
      targetId: "y"
    });
    expect(result.kind).toBe("related_to");
  });
});

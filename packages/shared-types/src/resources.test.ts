import { describe, expect, it } from "vitest";
import { entityRefOf, sameEntityRef } from "./resources";
import { isRelationPairAllowed } from "./search";

describe("EntityRef (ADR-0014)", () => {
  it("derives the owning module from the entity type", () => {
    expect(entityRefOf("account", "a1")).toEqual({ moduleId: "finance", entityType: "account", entityId: "a1" });
    expect(entityRefOf("document", "d1").moduleId).toBe("documents");
  });

  it("compares by type and id", () => {
    expect(sameEntityRef(entityRefOf("task", "1"), entityRefOf("task", "1"))).toBe(true);
    expect(sameEntityRef(entityRefOf("task", "1"), entityRefOf("note", "1"))).toBe(false);
    expect(sameEntityRef(null, null)).toBe(true);
    expect(sameEntityRef(null, entityRefOf("task", "1"))).toBe(false);
  });

  it("a document can be related to a finance account (additive type)", () => {
    expect(isRelationPairAllowed("related_to", "document", "account")).toBe(true);
    expect(isRelationPairAllowed("supports", "document", "account")).toBe(false);
  });
});

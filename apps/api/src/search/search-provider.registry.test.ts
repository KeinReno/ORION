import { describe, expect, it } from "vitest";
import { InboxTargetRegistry } from "../inbox/inbox-target.registry";
import type { SearchProvider } from "./search-provider";
import { SearchProviderRegistry } from "./search-provider.registry";

const provider = (entityType: SearchProvider["entityType"]): SearchProvider => ({ entityType, componentId: "notes", search: async () => [] });

describe("SearchProviderRegistry", () => {
  it("returns providers in the canonical order regardless of registration order", () => {
    const registry = new SearchProviderRegistry();
    for (const type of ["savings_goal", "task", "project", "note"] as const) registry.register(provider(type));
    expect(registry.list().map((p) => p.entityType)).toEqual(["project", "task", "note", "savings_goal"]);
  });

  it("rejects a second provider for the same type", () => {
    const registry = new SearchProviderRegistry();
    registry.register(provider("task"));
    expect(() => registry.register(provider("task"))).toThrow(/task/);
  });
});

describe("InboxTargetRegistry", () => {
  it("finds a registered target and rejects duplicates", () => {
    const registry = new InboxTargetRegistry();
    const target = { kind: "note" as const, componentId: "notes" as const, createTx: async () => "id" };
    registry.register(target);
    expect(registry.get("note")).toBe(target);
    expect(registry.get("task")).toBeUndefined();
    expect(() => registry.register(target)).toThrow(/note/);
  });
});

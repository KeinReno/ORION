import { describe, expect, it } from "vitest";
import { buildDevelopmentImport } from "./catalog-import-builder";
import type { TrustedDevelopmentCatalog } from "./catalog-trust";

const catalog: TrustedDevelopmentCatalog = {
  catalogId: "orion-dev",
  projects: [{ id: "p", title: "Canonical project" }],
  workItems: [
    { id: "a", project: "p", title: "First", dependsOn: ["b"] },
    { id: "b", project: "p", title: "Second" }
  ]
};

describe("trusted development import builder", () => {
  it("derives all declarations and dependency edges from catalog", () => {
    const result = buildDevelopmentImport(catalog, "workspace");
    expect(result.projects).toEqual([{ externalId: "p", title: "Canonical project" }]);
    expect(result.tasks).toEqual([
      { externalId: "a", projectExternalId: "p", title: "First" },
      { externalId: "b", projectExternalId: "p", title: "Second" }
    ]);
    expect(result.dependencies).toEqual([
      { externalId: "a", dependsOn: ["b"] },
      { externalId: "b", dependsOn: [] }
    ]);
  });
  it("carries only explicit existing-ID selections", () => {
    const result = buildDevelopmentImport(catalog, "workspace", {
      projects: { p: "canonical-project-id" },
      tasks: { a: "canonical-task-id" }
    });
    expect(result.projects[0]!.confirmedExistingId).toBe("canonical-project-id");
    expect(result.tasks[0]!.confirmedExistingId).toBe("canonical-task-id");
    expect(result.tasks[1]!.confirmedExistingId).toBeUndefined();
  });
  it("rejects unknown, duplicate and empty selections", () => {
    expect(() => buildDevelopmentImport(catalog, "workspace", { projects: { unknown: "id" } })).toThrow();
    expect(() => buildDevelopmentImport(catalog, "workspace", { tasks: { a: "" } })).toThrow();
    expect(() => buildDevelopmentImport(catalog, "workspace", { tasks: { a: "same", b: "same" } })).toThrow();
    expect(() => buildDevelopmentImport(catalog, "")).toThrow();
  });
  it("rejects invalid catalog dependencies before building a write payload", () => {
    expect(() => buildDevelopmentImport({
      ...catalog,
      workItems: [{ id: "a", project: "p", title: "First", dependsOn: ["missing"] }]
    }, "workspace")).toThrow();
  });
});

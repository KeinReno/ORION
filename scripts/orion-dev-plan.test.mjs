import { describe, expect, it } from "vitest";
import { planOrionDevImport } from "./orion-dev-plan.mjs";

const catalog = {
  schemaVersion: 1, catalogId: "orion-dev",
  projects: [{ id: "core", title: "ORION CORE" }],
  workItems: [
    { id: "DEV-1", project: "core", title: "First" },
    { id: "DEV-2", project: "core", title: "Second", dependsOn: ["DEV-1"] }
  ]
};

describe("ORION DEV dry-run planner", () => {
  it("proposes creation without mutating input", () => {
    const before = JSON.stringify(catalog);
    const plan = planOrionDevImport(catalog);
    expect(plan.mode).toBe("dry-run");
    expect(plan.actions.filter((a) => a.action === "propose_create")).toHaveLength(4);
    expect(JSON.stringify(catalog)).toBe(before);
  });

  it("requires review for name matches rather than trusting them as identity", () => {
    const plan = planOrionDevImport(catalog, {
      workspaces: [{ id: "w", name: "ORION DEV" }],
      projects: [{ id: "p", workspaceId: "w", name: "ORION CORE" }],
      tasks: [{ id: "t", workspaceId: "w", projectId: "p", title: "First" }]
    });
    expect(plan.actions.find((a) => a.externalId === "DEV-1").action).toBe("review_possible_match");
    expect(plan.actions.find((a) => a.externalId === "DEV-1").candidateIds).toEqual(["t"]);
  });

  it("rejects duplicate IDs and dependency cycles", () => {
    expect(() => planOrionDevImport({ ...catalog, workItems: [...catalog.workItems, catalog.workItems[0]] })).toThrow(/duplicate/);
    const cyclic = structuredClone(catalog);
    cyclic.workItems[0].dependsOn = ["DEV-2"];
    expect(() => planOrionDevImport(cyclic)).toThrow(/cycle/);
  });

  it("rejects foreign project references and ambiguous workspace names", () => {
    const invalid = structuredClone(catalog);
    invalid.workItems[0].project = "missing";
    expect(() => planOrionDevImport(invalid)).toThrow(/Unknown project/);
    expect(() => planOrionDevImport(catalog, {
      workspaces: [{ id: "1", name: "ORION DEV" }, { id: "2", name: "orion dev" }]
    })).toThrow(/Ambiguous/);
  });
  it("recognizes durable project and task mappings without recreating them", () => {
    const plan = planOrionDevImport(catalog, {
      workspaces: [{ id: "w", name: "ORION DEV" }],
      projects: [{ id: "p", workspaceId: "w", name: "ORION CORE" }],
      tasks: [{ id: "t", workspaceId: "w", projectId: "p", title: "First" }],
      mappings: [
        { catalogId: "orion-dev", workspaceId: "w", kind: "project", externalId: "core", entityId: "p" },
        { catalogId: "orion-dev", workspaceId: "w", kind: "task", externalId: "DEV-1", entityId: "t" }
      ]
    });
    expect(plan.actions.find((a) => a.kind === "project").action).toBe("already_mapped");
    expect(plan.actions.find((a) => a.externalId === "DEV-1").action).toBe("already_mapped");
  });

  it("rejects stale and duplicate mappings", () => {
    const snapshot = {
      workspaces: [{ id: "w", name: "ORION DEV" }],
      mappings: [{ catalogId: "orion-dev", workspaceId: "w", kind: "project", externalId: "core", entityId: "missing" }]
    };
    expect(() => planOrionDevImport(catalog, snapshot)).toThrow(/Stale project mapping/);
    expect(() => planOrionDevImport(catalog, {
      ...snapshot, mappings: [...snapshot.mappings, ...snapshot.mappings]
    })).toThrow(/Duplicate mapping/);
  });

  it("rejects mappings that belong to another workspace", () => {
    expect(() => planOrionDevImport(catalog, {
      workspaces: [{ id: "w", name: "ORION DEV" }],
      projects: [{ id: "p", workspaceId: "w", name: "ORION CORE" }],
      mappings: [{ catalogId: "orion-dev", workspaceId: "other", kind: "project", externalId: "core", entityId: "p" }]
    })).toThrow(/Foreign or unresolved workspace mapping/);
  });

  it("does not trust mappings without an explicit workspace scope", () => {
    expect(() => planOrionDevImport(catalog, {
      workspaces: [{ id: "w", name: "ORION DEV" }],
      mappings: [{ catalogId: "orion-dev", kind: "project", externalId: "core", entityId: "p" }]
    })).toThrow(/Invalid mapping/);
  });

  it("rejects mappings to IDs removed from the catalog", () => {
    expect(() => planOrionDevImport(catalog, {
      workspaces: [{ id: "w", name: "ORION DEV" }],
      mappings: [{ catalogId: "orion-dev", workspaceId: "w", kind: "task", externalId: "DEV-removed", entityId: "t" }]
    })).toThrow(/Unknown mapped task/);
  });

  it("rejects a project name collision against a different mapped entity", () => {
    expect(() => planOrionDevImport(catalog, {
      workspaces: [{ id: "w", name: "ORION DEV" }],
      projects: [
        { id: "p1", workspaceId: "w", name: "ORION CORE" },
        { id: "p2", workspaceId: "w", name: "Renamed project" }
      ],
      mappings: [{ catalogId: "orion-dev", workspaceId: "w", kind: "project", externalId: "core", entityId: "p2" }]
    })).toThrow(/Conflicting project name and mapping/);
  });

  it("rejects a task title collision against a different mapped entity", () => {
    expect(() => planOrionDevImport(catalog, {
      workspaces: [{ id: "w", name: "ORION DEV" }],
      projects: [{ id: "p", workspaceId: "w", name: "ORION CORE" }],
      tasks: [
        { id: "t1", workspaceId: "w", projectId: "p", title: "First" },
        { id: "t2", workspaceId: "w", projectId: "p", title: "Renamed task" }
      ],
      mappings: [
        { catalogId: "orion-dev", workspaceId: "w", kind: "project", externalId: "core", entityId: "p" },
        { catalogId: "orion-dev", workspaceId: "w", kind: "task", externalId: "DEV-1", entityId: "t2" }
      ]
    })).toThrow(/Conflicting task name and mapping/);
  });

});

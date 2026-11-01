import { describe, expect, it } from "vitest";
import { planDevelopmentImport, type PreviewSnapshot } from "./catalog-server-plan";
import type { TrustedDevelopmentCatalog } from "./catalog-trust";

const catalog: TrustedDevelopmentCatalog = {
  catalogId: "orion-dev",
  projects: [{ id: "core", title: "Core" }],
  workItems: [{ id: "review", project: "core", title: "Review" }]
};
const snapshot: PreviewSnapshot = {
  targetWorkspaceId: "w",
  workspaces: [{ id: "w", name: "ORION DEV" }],
  projects: [],
  tasks: [],
  mappings: []
};

describe("server-side development dry-run", () => {
  it("proposes missing canonical entities without writes", () => {
    expect(planDevelopmentImport(catalog, snapshot).actions.map((row) => row.action))
      .toEqual(["propose_create", "propose_create"]);
  });
  it("requires review for name matches", () => {
    const result = planDevelopmentImport(catalog, {
      ...snapshot, projects: [{ id: "p", workspaceId: "w", name: "Core" }],
      tasks: [{ id: "t", workspaceId: "w", projectId: "p", title: "Review" }]
    });
    expect(result.actions.map((row) => row.action))
      .toEqual(["review_possible_match", "review_possible_match"]);
  });
  it("uses durable mappings and rejects stale or foreign mappings", () => {
    const mapped: PreviewSnapshot = {
      ...snapshot,
      projects: [{ id: "p", workspaceId: "w", name: "Core" }],
      tasks: [{ id: "t", workspaceId: "w", projectId: "p", title: "Review" }],
      mappings: [
        { workspaceId: "w", catalogId: "orion-dev", kind: "project", externalId: "core", entityId: "p" },
        { workspaceId: "w", catalogId: "orion-dev", kind: "task", externalId: "review", entityId: "t" }
      ]
    };
    expect(planDevelopmentImport(catalog, mapped).actions.map((row) => row.action))
      .toEqual(["already_mapped", "already_mapped"]);
    expect(() => planDevelopmentImport(catalog, { ...mapped, tasks: [] })).toThrow(/Stale task/);
    expect(() => planDevelopmentImport(catalog, {
      ...mapped, mappings: [{ ...mapped.mappings[0]!, workspaceId: "foreign" }]
    })).toThrow(/Foreign/);
  });
  it("rejects orphaned project and task mappings from a changed catalog", () => {
    for (const kind of ["project", "task"] as const) {
      expect(() => planDevelopmentImport(catalog, {
        ...snapshot,
        mappings: [{
          workspaceId: "w",
          catalogId: "orion-dev",
          kind,
          externalId: "removed-external-id",
          entityId: "existing-entity"
        }]
      })).toThrow(/Unknown development catalog mapping/);
    }
  });
  it("rejects foreign workspace entities and duplicate canonical IDs", () => {
    expect(() => planDevelopmentImport(catalog, {
      ...snapshot, projects: [{ id: "foreign", workspaceId: "other", name: "Core" }]
    })).toThrow(/Invalid or foreign/);
    expect(() => planDevelopmentImport(catalog, {
      ...snapshot, tasks: [{ id: "foreign", workspaceId: "other", projectId: null, title: "Review" }]
    })).toThrow(/Invalid or foreign/);
    expect(() => planDevelopmentImport(catalog, {
      ...snapshot, projects: [
        { id: "same", workspaceId: "w", name: "Core" },
        { id: "same", workspaceId: "w", name: "Other" }
      ]
    })).toThrow(/Invalid or foreign/);
  });
  it("rejects orphaned task project references in a partial snapshot", () => {
    expect(() => planDevelopmentImport(catalog, {
      ...snapshot,
      tasks: [{ id: "t", workspaceId: "w", projectId: "missing", title: "Review" }]
    })).toThrow(/Orphaned development preview task/);
    expect(() => planDevelopmentImport(catalog, {
      ...snapshot,
      projects: [{ id: "p", workspaceId: "w", name: "Core" }],
      tasks: [{ id: "t", workspaceId: "w", projectId: "p", title: "Review" }]
    })).not.toThrow();
  });
  it("rejects ambiguous project names and invalid catalogs", () => {
    expect(() => planDevelopmentImport(catalog, {
      ...snapshot, projects: [
        { id: "p1", workspaceId: "w", name: "Core" },
        { id: "p2", workspaceId: "w", name: "core" }
      ]
    })).toThrow(/Ambiguous/);
    expect(() => planDevelopmentImport({
      ...catalog, workItems: [{ id: "review", project: "core", title: "Review", dependsOn: ["missing"] }]
    }, snapshot)).toThrow();
  });
});

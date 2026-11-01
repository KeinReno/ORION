import { describe, expect, it } from "vitest";
import { assertTrustedCatalogImport, type TrustedDevelopmentCatalog } from "./catalog-trust";
import type { ConfirmedDevelopmentImport } from "./catalog-import-transaction";

const catalog: TrustedDevelopmentCatalog = {
  catalogId: "orion-dev",
  projects: [{ id: "p", title: "Canonical project" }],
  workItems: [
    { id: "a", project: "p", title: "First", dependsOn: ["b"] },
    { id: "b", project: "p", title: "Second" }
  ]
};
const request: ConfirmedDevelopmentImport = {
  workspaceId: "workspace", catalogId: "orion-dev", workspaceConfirmed: true,
  projects: [{ externalId: "p", title: "Canonical project" }],
  tasks: [
    { externalId: "a", projectExternalId: "p", title: "First" },
    { externalId: "b", projectExternalId: "p", title: "Second" }
  ],
  dependencies: [
    { externalId: "a", dependsOn: ["b"] },
    { externalId: "b", dependsOn: [] }
  ]
};

describe("trusted catalog import declarations", () => {
  it("accepts exact catalog declarations and explicit existing ID confirmation", () => {
    expect(() => assertTrustedCatalogImport(catalog, request)).not.toThrow();
    expect(() => assertTrustedCatalogImport(catalog, {
      ...request, projects: [{ ...request.projects[0]!, confirmedExistingId: "existing-id" }]
    })).not.toThrow();
  });
  it("rejects injected tasks and omitted declarations", () => {
    expect(() => assertTrustedCatalogImport(catalog, {
      ...request, tasks: [...request.tasks, { externalId: "evil", projectExternalId: "p", title: "Injected" }]
    })).toThrow();
    expect(() => assertTrustedCatalogImport(catalog, {
      ...request, tasks: request.tasks.slice(0, 1)
    })).toThrow();
  });
  it("rejects changed titles, project assignments and dependency tampering", () => {
    expect(() => assertTrustedCatalogImport(catalog, {
      ...request, projects: [{ externalId: "p", title: "Different" }]
    })).toThrow();
    expect(() => assertTrustedCatalogImport(catalog, {
      ...request, tasks: [{ ...request.tasks[0]!, projectExternalId: "other" }, request.tasks[1]!]
    })).toThrow();
    expect(() => assertTrustedCatalogImport(catalog, {
      ...request, dependencies: [{ externalId: "a", dependsOn: [] }, request.dependencies[1]!]
    })).toThrow();
  });
  it("rejects invalid trusted catalogs and cycles", () => {
    expect(() => assertTrustedCatalogImport({
      ...catalog, workItems: [{ id: "a", project: "p", title: "First", dependsOn: ["b"] },
        { id: "b", project: "p", title: "Second", dependsOn: ["a"] }]
    }, request)).toThrow();
    expect(() => assertTrustedCatalogImport({
      ...catalog, projects: [...catalog.projects, catalog.projects[0]!]
    }, request)).toThrow();
  });
});

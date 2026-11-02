import { beforeAll, describe, expect, it } from "vitest";
import { planDevelopmentImport, type PreviewSnapshot } from "./catalog-server-plan";
import type { TrustedDevelopmentCatalog } from "./catalog-trust";

// Exercise the CLI entry point too, rather than comparing the shared function to itself.
const cliPath = "../../../../scripts/orion-dev-plan.mjs";
let planOrionDevImport: (catalog: unknown, snapshot: unknown) => { actions: Record<string, unknown>[] };
beforeAll(async () => { ({ planOrionDevImport } = await import(cliPath)); });
const catalog: TrustedDevelopmentCatalog = {
  schemaVersion: 1, catalogId: "orion-dev",
  phases: [{ id: "foundation" }],
  projects: [{ id: "core", title: "ORION CORE", phase: "foundation" }],
  workItems: [
    { id: "a", project: "core", title: "First" },
    { id: "b", project: "core", title: "Second", dependsOn: ["a"] }
  ]
};
const snapshot: PreviewSnapshot = {
  targetWorkspaceId: "w", workspaces: [{ id: "w", name: "Orion Dev" }],
  projects: [{ id: "p", workspaceId: "w", name: "ORION CORE" }],
  tasks: [{ id: "t", workspaceId: "w", projectId: "p", title: "First" }], mappings: []
};
const normalize = (rows: Record<string, unknown>[]) => rows.filter(row => row.kind !== "workspace")
  .map(row => ({ kind: row.kind, externalId: row.externalId, title: row.title,
    action: row.action, candidateId: row.candidateId, project: row.projectExternalId,
    dependencies: row.dependsOn }))
  .sort((a, b) => String(a.externalId).localeCompare(String(b.externalId)));

describe("CLI / API development planner parity", () => {
  it.each([false, true])("agrees on reviewed and renamed mapped candidates (mapped=%s)", mapped => {
    const data = structuredClone(snapshot);
    if (mapped) {
      data.projects = [{ ...data.projects[0]!, name: "Manually renamed" }];
      data.tasks = [{ ...data.tasks[0]!, title: "Manually renamed task" }];
      data.mappings = [
        { workspaceId: "w", catalogId: "orion-dev", kind: "project", externalId: "core", entityId: "p" },
        { workspaceId: "w", catalogId: "orion-dev", kind: "task", externalId: "a", entityId: "t" }
      ];
    }
    expect(normalize(planOrionDevImport(catalog, data).actions))
      .toEqual(normalize(planDevelopmentImport(catalog, data).actions));
  });

  it.each(["stale", "foreign", "orphan", "duplicate", "collision", "foreignCatalog"])(
    "both reject %s snapshot conflicts", kind => {
      const data = structuredClone(snapshot);
      if (kind === "stale") data.mappings = [{ workspaceId: "w", catalogId: "orion-dev", kind: "task", externalId: "a", entityId: "missing" }];
      if (kind === "foreign") data.projects = [{ ...data.projects[0]!, workspaceId: "other" }];
      if (kind === "orphan") data.projects = [];
      if (kind === "duplicate") data.tasks = [...data.tasks, ...data.tasks];
      if (kind === "collision") {
        data.tasks = [...data.tasks, { ...data.tasks[0]!, id: "renamed", title: "Renamed" }];
        data.mappings = [{ workspaceId: "w", catalogId: "orion-dev", kind: "task", externalId: "a", entityId: "renamed" }];
      }
      if (kind === "foreignCatalog") data.mappings = [{ workspaceId: "w", catalogId: "other", kind: "task", externalId: "a", entityId: "t" }];
      expect(() => planOrionDevImport(catalog, data)).toThrow();
      expect(() => planDevelopmentImport(catalog, data)).toThrow();
    });

  it.each(["phase", "phaseCycle", "taskCycle", "duplicateDependency", "duplicateTitle"])(
    "both reject %s catalog conflicts", kind => {
      const data = structuredClone(catalog);
      if (kind === "phase") data.phases = [];
      if (kind === "phaseCycle") data.phases = [{ id: "foundation", dependsOn: ["foundation"] }];
      if (kind === "taskCycle") data.workItems = [{ ...data.workItems[0]!, dependsOn: ["b"] }, data.workItems[1]!];
      if (kind === "duplicateDependency") data.workItems = [data.workItems[0]!, { ...data.workItems[1]!, dependsOn: ["a", "a"] }];
      if (kind === "duplicateTitle") data.projects = [...data.projects, { id: "duplicate", title: " orion core " }];
      expect(() => planOrionDevImport(data, snapshot)).toThrow();
      expect(() => planDevelopmentImport(data, snapshot)).toThrow();
    });
});

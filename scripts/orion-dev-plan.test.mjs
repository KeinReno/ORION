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
    expect(plan.actions[0]).toMatchObject({ kind: "workspace", action: "review_possible_match", candidateId: "w" });
    expect(plan.actions.find((a) => a.kind === "project")).toMatchObject({ action: "review_possible_match", candidateId: "p" });
    expect(plan.actions.find((a) => a.externalId === "DEV-1").action).toBe("review_possible_match");
    expect(plan.actions.find((a) => a.externalId === "DEV-1").candidateIds).toEqual(["t"]);
  });

  it("rejects duplicate or blank catalog project titles before matching", () => {
    const duplicate = structuredClone(catalog);
    duplicate.projects.push({ id: "core-two", title: "  orion core  " });
    expect(() => planOrionDevImport(duplicate)).toThrow(/Duplicate catalog project title/);
    const blank = structuredClone(catalog);
    blank.projects[0].title = "  ";
    expect(() => planOrionDevImport(blank)).toThrow(/Invalid project title/);
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

  it("rejects unknown phase references and phase dependency cycles", () => {
    const invalid = structuredClone(catalog);
    invalid.phases = [{ id: "foundation", dependsOn: [] }];
    invalid.projects[0].phase = "missing";
    expect(() => planOrionDevImport(invalid)).toThrow(/Unknown project phase/);
    const cycle = structuredClone(catalog);
    cycle.phases = [
      { id: "one", dependsOn: ["two"] },
      { id: "two", dependsOn: ["one"] }
    ];
    expect(() => planOrionDevImport(cycle)).toThrow(/Phase dependency cycle/);
  });

  it("rejects unknown phase dependencies and task phase references", () => {
    const missing = structuredClone(catalog);
    missing.phases = [{ id: "foundation", dependsOn: ["missing"] }];
    expect(() => planOrionDevImport(missing)).toThrow(/Unknown phase dependency/);
    const task = structuredClone(catalog);
    task.workItems[0].phase = "missing";
    expect(() => planOrionDevImport(task)).toThrow(/Unknown task phase/);
  });

  it("rejects duplicate snapshot entity IDs before proposing writes", () => {
    for (const [field, rows] of [
      ["workspaces", [{ id: "w", name: "ORION DEV" }, { id: "w", name: "Other" }]],
      ["projects", [{ id: "p", workspaceId: "w" }, { id: "p", workspaceId: "other" }]],
      ["tasks", [{ id: "t", projectId: "p" }, { id: "t", projectId: "other" }]]
    ]) {
      expect(() => planOrionDevImport(catalog, { [field]: rows })).toThrow(/duplicate snapshot/);
    }
  });

  it("rejects snapshot rows without stable string IDs", () => {
    expect(() => planOrionDevImport(catalog, { projects: [{ name: "ORION CORE" }] })).toThrow(/Invalid or duplicate snapshot project ID/);
    expect(() => planOrionDevImport(catalog, { tasks: [null] })).toThrow(/Invalid or duplicate snapshot task ID/);
  });

  it("fails closed when multiple tasks in one project share the catalog title", () => {
    expect(() => planOrionDevImport(catalog, {
      workspaces: [{ id: "w", name: "ORION DEV" }],
      projects: [{ id: "p", workspaceId: "w", name: "ORION CORE" }],
      tasks: [
        { id: "t1", workspaceId: "w", projectId: "p", title: "First" },
        { id: "t2", workspaceId: "w", projectId: "p", title: " first " }
      ]
    })).toThrow(/Ambiguous task: First/);
  });

  it("rejects null catalog rows and malformed dependency collections", () => {
    expect(() => planOrionDevImport({ ...catalog, projects: [null] })).toThrow(/Invalid or duplicate project ID/);
    expect(() => planOrionDevImport({ ...catalog, workItems: [null] })).toThrow(/Invalid or duplicate task ID/);
    expect(() => planOrionDevImport({ ...catalog, phases: [null] })).toThrow(/Invalid or duplicate phase ID/);
    expect(() => planOrionDevImport({ ...catalog, phases: [{ id: "foundation", dependsOn: "oops" }] })).toThrow(/Invalid phase dependencies/);
    expect(() => planOrionDevImport({ ...catalog, workItems: [{ ...catalog.workItems[0], dependsOn: "DEV-2" }] })).toThrow(/Invalid task dependencies/);
  });

  it("rejects null and non-object mapping rows with a controlled error", () => {
    for (const mapping of [null, undefined, "invalid", 42, []]) {
      expect(() => planOrionDevImport(catalog, {
        mappings: [mapping]
      })).toThrow("Invalid mapping");
    }
  });

  it("rejects catalog tasks with duplicate normalized titles in one project", () => {
    const duplicate = structuredClone(catalog);
    duplicate.workItems[1].title = " first ";
    expect(() => planOrionDevImport(duplicate)).toThrow(/Duplicate catalog task title/);
    duplicate.workItems[1].title = " ";
    expect(() => planOrionDevImport(duplicate)).toThrow(/Invalid task title/);
    duplicate.workItems[1].title = "First";
    duplicate.projects.push({ id: "other", title: "Other" });
    duplicate.workItems[1].project = "other";
    expect(() => planOrionDevImport(duplicate)).not.toThrow();
  });

});

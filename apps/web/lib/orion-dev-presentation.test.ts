import { describe, expect, it } from "vitest";
import { developmentPreviewSchema, type Project, type Task } from "@orion/shared-types";
import { buildOverview, displayTitle } from "../modules-ext/orion-dev/presentation";

const preview = developmentPreviewSchema.parse({
  catalogId: "orion-dev", catalogSha256: "a".repeat(64), previewDigest: "b".repeat(64), readOnly: true,
  snapshot: { targetWorkspaceId: "workspace", workspaces: [{ id: "workspace", name: "Dev" }] },
  catalog: { projects: [{ id: "core", title: "ORION CORE", phase: "foundation" }], workItems: [{ id: "DEV-001", phase: "foundation" }] },
  plan: { workspaceId: "workspace", actions: [
    { kind: "project", externalId: "core", title: "ORION CORE", action: "already_mapped", candidateId: "project" },
    { kind: "task", externalId: "DEV-001", title: "Verify event and module boundaries from code", action: "already_mapped", candidateId: "task", projectExternalId: "core" }
  ] }
});

describe("development overview projection", () => {
  it("uses durable IDs and preserves human names, statuses, archive and dependency state", () => {
    const project = { id: "project", name: "Моё ядро", archivedAt: "2026-11-02" } as Project;
    const task = { id: "task", title: "Моя проверка", status: "in_progress", blocked: true, dependencyIds: ["upstream"] } as Task;
    const result = buildOverview(preview, [project], [task]);
    expect(result.projects[0]).toMatchObject({ label: "Моё ядро", phase: "foundation", entity: project });
    expect(result.tasks[0]).toMatchObject({ label: "Моя проверка", phase: "foundation", entity: task });
    expect(result.missing).toBe(0);
    expect(result.unmapped).toBe(0);
  });
  it("never adopts a name match and distinguishes unavailable mapped data", () => {
    const match = { ...preview, plan: { ...preview.plan, actions: preview.plan.actions.map(row => ({ ...row, action: "review_possible_match" as const })) } };
    const result = buildOverview(match, [{ id: "project", name: "ORION CORE" } as Project], []);
    expect(result.projects[0].entity).toBeUndefined();
    expect(result.unmapped).toBe(2);
    expect(result.missing).toBe(0);
    expect(buildOverview(preview, [], []).missing).toBe(2);
  });
  it("localizes only unchanged catalog titles and preserves unknown catalog entries", () => {
    expect(displayTitle("project", "core", "ORION CORE")).toBe("Ядро платформы");
    expect(displayTitle("project", "core", "ORION CORE", "My core")).toBe("My core");
    expect(displayTitle("task", "CUSTOM", "New task")).toBe("New task");
  });
});

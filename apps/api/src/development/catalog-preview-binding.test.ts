import { describe, expect, it } from "vitest";
import { fingerprintDevelopmentPreview } from "./catalog-preview-binding";
import { planDevelopmentImport } from "./catalog-server-plan";

const catalog = { catalogId: "orion-dev", projects: [{ id: "p", title: "Project" }], workItems: [{ id: "t", project: "p", title: "Task" }] };
const snapshot = { targetWorkspaceId: "w", workspaces: [{ id: "w", name: "Workspace" }], projects: [{ id: "p1", workspaceId: "w", name: "Project" }], tasks: [], mappings: [] };
const preview = planDevelopmentImport(catalog, snapshot);
const binding = { userId: "u", workspaceId: "w", catalogDigest: "catalog-sha", preview, choices: { "project:p": "p1" } };

describe("development preview fingerprint", () => {
  it("is deterministic for equivalent reviewed choices", () => {
    expect(fingerprintDevelopmentPreview(binding)).toBe(fingerprintDevelopmentPreview({ ...binding, choices: { "project:p": "p1" } }));
    expect(fingerprintDevelopmentPreview(binding)).toMatch(/^[a-f0-9]{64}$/);
  });
  it("changes with user, workspace, catalog, choices or preview", () => {
    const original = fingerprintDevelopmentPreview(binding);
    expect(fingerprintDevelopmentPreview({ ...binding, userId: "other" })).not.toBe(original);
    expect(fingerprintDevelopmentPreview({ ...binding, catalogDigest: "new-catalog" })).not.toBe(original);
    expect(fingerprintDevelopmentPreview({ ...binding, choices: { "project:p": "other" } })).not.toBe(original);
    const changed = planDevelopmentImport(catalog, { ...snapshot, projects: [] });
    expect(fingerprintDevelopmentPreview({ ...binding, preview: changed })).not.toBe(original);
    expect(() => fingerprintDevelopmentPreview({ ...binding, workspaceId: "other" })).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { requireReviewedPreviewMatches } from "./catalog-preview-matches";
import { planDevelopmentImport } from "./catalog-server-plan";

const catalog = { catalogId: "orion-dev", projects: [{ id: "p", title: "Project" }], workItems: [{ id: "t", project: "p", title: "Task" }] };
const snapshot = { targetWorkspaceId: "w", workspaces: [{ id: "w", name: "Workspace" }], projects: [{ id: "p1", workspaceId: "w", name: "Project" }], tasks: [{ id: "t1", workspaceId: "w", projectId: "p1", title: "Task" }], mappings: [] };

describe("reviewed preview matches", () => {
  const preview = planDevelopmentImport(catalog, snapshot);
  it("accepts exact review of each proposed existing entity", () => {
    expect(() => requireReviewedPreviewMatches(preview, { "project:p": "p1", "task:t": "t1" })).not.toThrow();
  });
  it("rejects omitted, unknown or stale review decisions", () => {
    expect(() => requireReviewedPreviewMatches(preview, { "project:p": "p1" })).toThrow();
    expect(() => requireReviewedPreviewMatches(preview, { "project:p": "wrong", "task:t": "t1" })).toThrow();
    expect(() => requireReviewedPreviewMatches(preview, { "project:p": "p1", "task:t": "t1", "task:extra": "x" })).toThrow();
  });
});

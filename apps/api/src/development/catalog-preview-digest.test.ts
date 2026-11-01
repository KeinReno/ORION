import { describe, expect, it } from "vitest";
import { digestDevelopmentPreview } from "./catalog-preview-digest";

const scope = {
  userId: "user-1",
  workspaceId: "workspace-1",
  catalogId: "orion-dev",
  catalogSha256: "a".repeat(64)
};
const snapshot = {
  projects: [{ id: "project-1", name: "Core" }],
  tasks: [{ id: "task-1", title: "Review" }],
  mappings: []
};

describe("development preview digest", () => {
  it("is deterministic for identical scope and snapshot", () => {
    const digest = digestDevelopmentPreview(scope, snapshot);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digestDevelopmentPreview(scope, snapshot)).toBe(digest);
  });
  it("changes with user, workspace, catalog revision or snapshot contents", () => {
    const digest = digestDevelopmentPreview(scope, snapshot);
    expect(digestDevelopmentPreview({ ...scope, userId: "user-2" }, snapshot)).not.toBe(digest);
    expect(digestDevelopmentPreview({ ...scope, workspaceId: "workspace-2" }, snapshot)).not.toBe(digest);
    expect(digestDevelopmentPreview({ ...scope, catalogSha256: "b".repeat(64) }, snapshot)).not.toBe(digest);
    expect(digestDevelopmentPreview(scope, { ...snapshot, tasks: [] })).not.toBe(digest);
  });
  it("rejects invalid scope and snapshot", () => {
    expect(() => digestDevelopmentPreview({ ...scope, userId: "" }, snapshot)).toThrow();
    expect(() => digestDevelopmentPreview({ ...scope, catalogSha256: "bad" }, snapshot)).toThrow();
    expect(() => digestDevelopmentPreview(scope, null)).toThrow();
  });
});

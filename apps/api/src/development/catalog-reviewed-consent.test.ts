import { describe, expect, it } from "vitest";
import { planDevelopmentImport } from "./catalog-server-plan";
import { buildReviewedConsentScope } from "./catalog-reviewed-consent";

const catalog = {
  catalogId: "orion-dev",
  projects: [{ id: "core", title: "Core" }],
  workItems: [{ id: "task", project: "core", title: "Review" }]
};
const preview = planDevelopmentImport(catalog, {
  targetWorkspaceId: "w",
  workspaces: [{ id: "w", name: "ORION DEV" }],
  projects: [{ id: "p", workspaceId: "w", name: "Core" }],
  tasks: [],
  mappings: []
});
const input = {
  userId: "u", workspaceId: "w",
  catalogSha256: "a".repeat(64), previewDigest: "b".repeat(64),
  preview, choices: { "project:core": "p" }
};

describe("reviewed development consent scope", () => {
  it("binds approved candidate, actor and catalog to a fingerprint", () => {
    const scope = buildReviewedConsentScope(input);
    expect(scope.catalogId).toBe("orion-dev");
    expect(scope.selectionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(buildReviewedConsentScope(input).selectionHash).toBe(scope.selectionHash);
    expect(buildReviewedConsentScope({ ...input, userId: "other" }).selectionHash)
      .not.toBe(scope.selectionHash);
  });

  it("rejects missing, extra or stale candidate approvals", () => {
    const invalidChoices: Record<string, string>[] = [{}, { "project:core": "wrong" }, {
      "project:core": "p", "task:task": "t"
    }];
    for (const choices of invalidChoices) {
      expect(() => buildReviewedConsentScope({ ...input, choices })).toThrow();
    }
  });

  it("rejects mismatched workspace and malformed catalog digest", () => {
    expect(() => buildReviewedConsentScope({ ...input, workspaceId: "foreign" })).toThrow();
    expect(() => buildReviewedConsentScope({ ...input, catalogSha256: "bad" })).toThrow();
  });
});

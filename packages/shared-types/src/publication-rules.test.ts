import { describe, expect, it } from "vitest";
import { publicationRuleConfigSchema, publicationRuleEnableSchema } from "./publication";

const sourceWorkspaceId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
describe("publication rule disclosure contract", () => {
  it("defaults to no text, due date or delegated writes", () => {
    expect(publicationRuleConfigSchema.parse({ sourceWorkspaceId, workspaceId, name: "Selected tasks" }))
      .toMatchObject({ includeText: false, includeDueAt: false, allowStatus: false, projectIds: [], statuses: [] });
  });
  it("does not accept a combined exchange mode or arbitrary private fields", () => {
    for (const field of [{ mode: "family-full" }, { includeAttachments: true }, { kind: "knowledge" }]) {
      expect(publicationRuleConfigSchema.safeParse({ sourceWorkspaceId, workspaceId, name: "Rule", ...field }).success).toBe(false);
    }
    expect(publicationRuleConfigSchema.safeParse({ sourceWorkspaceId, workspaceId: sourceWorkspaceId, name: "Self" }).success).toBe(false);
  });
  it("requires explicit future-record consent as well as a preview fingerprint and revision", () => {
    const input = { expectedRevision: 1, fingerprint: "a".repeat(64) };
    expect(publicationRuleEnableSchema.safeParse(input).success).toBe(false);
    expect(publicationRuleEnableSchema.safeParse({ ...input, consentFutureRecords: false }).success).toBe(false);
    expect(publicationRuleEnableSchema.safeParse({ ...input, consentFutureRecords: true }).success).toBe(true);
  });
});

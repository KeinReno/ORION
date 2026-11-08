import { describe, expect, it } from "vitest";
import { sanitizeMigrationExchangeRows, type RiskyMigrationExchangeRows } from "./migration-exchange-sanitizer";

const revokedAt = "2026-11-08T20:00:00.000Z";
const sourceWorkspaceId = "11111111-1111-4111-8111-111111111111";
const destinationWorkspaceId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const sourceObjectId = "44444444-4444-4444-8444-444444444444";

function rows(): RiskyMigrationExchangeRows {
  return {
    publication_rules: [{
      id: "rule-id", workspaceId: sourceWorkspaceId, userId, targetWorkspaceId: destinationWorkspaceId,
      config: { sourceWorkspaceId, workspaceId: destinationWorkspaceId, name: "Rule", projectIds: [], statuses: [], includeText: true, includeDueAt: false, allowStatus: false },
      enabled: true, revision: 8, lastRunAt: "2026-11-07T00:00:00.000Z", lastError: null,
      history: [{ at: "2026-11-01T00:00:00.000Z", action: "created" }, { at: "2026-11-02T00:00:00.000Z", action: "enabled", fingerprint: "a".repeat(64), consentFutureRecords: true }],
      createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z"
    }],
    shared_publications: [{
      id: "publication-id", ruleId: "rule-id", workspaceId: destinationWorkspaceId, publisherId: userId,
      kind: "task", sourceWorkspaceId, sourceId: sourceObjectId, sourceRevision: 3,
      content: { title: "Published task", text: "Historical projection", status: "in_progress", dueAt: null },
      includeText: true, includeDueAt: false, allowStatus: true, revision: 4, revokedAt: null,
      createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z"
    }],
    cross_workspace_grants: [{
      id: "grant-id", workspaceId: sourceWorkspaceId, granterId: "membership-id", granteeUserId: userId,
      objectType: "note", objectId: sourceObjectId, scope: "full", projectionFields: [], expiresAt: null,
      createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z", revokedAt: null, revokedByUserId: null
    }],
    calendar_connections: [{
      id: "calendar-id", workspaceId: sourceWorkspaceId, name: "External calendar", kind: "ics",
      url: "https://calendar.example.test/feed.ics", username: "calendar-reader", passwordEnc: "opaque-ciphertext",
      color: null, enabled: true, lastSyncAt: "2026-11-07T00:00:00.000Z", lastError: null,
      createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-11-07T00:00:00.000Z"
    }]
  };
}

describe("migration exchange sanitizer", () => {
  it("pauses rules, revokes active publications and grants, and disables calendar pulls", () => {
    const input = rows();
    const before = structuredClone(input);
    const result = sanitizeMigrationExchangeRows(input, revokedAt);

    expect(result.publication_rules[0]).toMatchObject({ id: "rule-id", workspaceId: sourceWorkspaceId, userId, targetWorkspaceId: destinationWorkspaceId, enabled: false, revision: 9, lastError: "После переноса требуется новый предпросмотр и подтверждение" });
    expect(result.publication_rules[0]!.history).toEqual(input.publication_rules[0]!.history);
    expect(result.shared_publications[0]).toMatchObject({ id: "publication-id", workspaceId: destinationWorkspaceId, publisherId: userId, revokedAt });
    expect(result.shared_publications[0]!.content).toEqual(input.shared_publications[0]!.content);
    expect(result.cross_workspace_grants[0]).toMatchObject({ id: "grant-id", workspaceId: sourceWorkspaceId, granterId: "membership-id", granteeUserId: userId, revokedAt });
    expect(result.calendar_connections[0]).toMatchObject({ id: "calendar-id", workspaceId: sourceWorkspaceId, enabled: false, lastSyncAt: input.calendar_connections[0]!.lastSyncAt, lastError: null });
    expect(input).toEqual(before);
  });

  it("preserves existing revoke timestamps and leaves completed connection history unchanged", () => {
    const input = rows();
    const older = "2026-10-01T00:00:00.000Z";
    input.shared_publications = [{ ...input.shared_publications[0]!, revokedAt: older }];
    input.cross_workspace_grants = [{ ...input.cross_workspace_grants[0]!, revokedAt: older, revokedByUserId: userId }];
    input.calendar_connections = [{ ...input.calendar_connections[0]!, enabled: false, lastError: "remote unavailable" }];
    const output = sanitizeMigrationExchangeRows(input, revokedAt);
    expect(output.shared_publications[0]!.revokedAt).toBe(older);
    expect(output.cross_workspace_grants[0]!.revokedAt).toBe(older);
    expect(output.cross_workspace_grants[0]!.revokedByUserId).toBe(userId);
    expect(output.calendar_connections[0]!.lastError).toBe("remote unavailable");
  });

  it("fails closed on unsupported grant scopes, policy configurations, history, and connection URLs", () => {
    const projectionGrant = rows();
    projectionGrant.cross_workspace_grants = [{ ...projectionGrant.cross_workspace_grants[0]!, scope: "projection", projectionFields: ["title"] }];
    expect(() => sanitizeMigrationExchangeRows(projectionGrant, revokedAt)).toThrow("Unsupported cross_workspace_grants scope or object type");

    const wrongRule = rows();
    wrongRule.publication_rules = [{ ...wrongRule.publication_rules[0]!, config: { ...wrongRule.publication_rules[0]!.config as object, sourceWorkspaceId: destinationWorkspaceId } }];
    expect(() => sanitizeMigrationExchangeRows(wrongRule, revokedAt)).toThrow("Unsupported publication_rules configuration");

    const unknownHistory = rows();
    unknownHistory.publication_rules = [{ ...unknownHistory.publication_rules[0]!, history: [{ at: "2026-11-01T00:00:00.000Z", action: "future_action" }] }];
    expect(() => sanitizeMigrationExchangeRows(unknownHistory, revokedAt)).toThrow("Unsupported publication_rules history");

    const unsafeConnection = rows();
    unsafeConnection.calendar_connections = [{ ...unsafeConnection.calendar_connections[0]!, url: "file:///private/calendar.ics" }];
    expect(() => sanitizeMigrationExchangeRows(unsafeConnection, revokedAt)).toThrow("Unsupported calendar_connections URL");
  });

  it("rejects invalid time or incomplete ownership fields without echoing input", () => {
    const input = rows();
    expect(() => sanitizeMigrationExchangeRows(input, "yesterday")).toThrow("Unsupported deactivation time");
    const missingOwner = rows();
    missingOwner.cross_workspace_grants = [{ ...missingOwner.cross_workspace_grants[0]!, granteeUserId: "" }];
    expect(() => sanitizeMigrationExchangeRows(missingOwner, revokedAt)).toThrow("Unsupported cross_workspace_grants row");
  });
});

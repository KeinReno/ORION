import { describe, expect, it } from "vitest";
import { sanitizeMigrationSideEffectRows, type RiskyMigrationSideEffectRows } from "./migration-side-effect-sanitizer";

const when = "2026-11-08T20:00:00.000Z";

function rows(): RiskyMigrationSideEffectRows {
  return {
    sync_remotes: [{ id: "remote", workspaceId: "workspace", url: "https://cloud.example", username: "owner", passwordEnc: "ciphertext", autoEveryMs: 3600000 }],
    sync_devices: [{ id: "device", userId: "user", name: "Phone", revokedAt: null }],
    sync_restore_operations: [{ id: "restore", workspaceId: "workspace", phase: "committed" }],
    health_grants: [{ id: "grant", workspaceId: "workspace", subjectId: "subject", granteeUserId: "user", level: "read" }],
    development_import_consents: [{ id: "consent", tokenHash: "old-consent-hash", consumedAt: null }],
    extension_secrets: [{ id: "secret", userId: "user", valueEnc: "stored-secret" }],
    agent_hub_executions: [{ id: "run", workspaceId: "workspace", status: "queued", workerId: "worker", leaseUntil: when }],
    agent_hub_runtime_sessions: [{ id: "session", workspaceId: "workspace", status: "active", closedAt: null, expiresAt: "2030-01-01T00:00:00.000Z" }],
    agent_hub_agent_credentials: [{ id: "binding", workspaceId: "workspace", profileId: "profile", tokenId: "token", enabled: true }],
    agent_proposals: [{ id: "proposal", workspaceId: "workspace", status: "pending" }],
    opportunity_attempts: [{ id: "attempt", leaseHash: "lease", leaseRunnerId: "runner", leaseExpiresAt: when, submitReserved: true, cancelRequested: false }],
    domain_event_deliveries: [{ id: "delivery", status: "pending", lastError: null, completedAt: null }]
  };
}

describe("migration side-effect sanitizer", () => {
  it("stops remotes, grants, leases and pending work without keeping secrets", () => {
    const source = rows();
    const before = structuredClone(source);
    const result = sanitizeMigrationSideEffectRows(source, when);
    expect(source).toEqual(before);
    expect(result.sync_remotes[0]).toMatchObject({ id: "remote", workspaceId: "workspace", username: "", passwordEnc: "", autoEveryMs: -1 });
    expect(result.sync_devices[0]).toMatchObject({ id: "device", userId: "user", revokedAt: when });
    expect(result.sync_restore_operations).toEqual([]);
    expect(result.health_grants).toEqual([]);
    expect(result.development_import_consents[0]!.tokenHash).not.toBe("old-consent-hash");
    expect(result.development_import_consents[0]!.consumedAt).toBe(when);
    expect(result.extension_secrets[0]!.valueEnc).toBe("");
    expect(result.agent_hub_executions[0]).toMatchObject({ id: "run", status: "blocked", workerId: null, leaseUntil: null });
    expect(result.agent_hub_runtime_sessions[0]).toMatchObject({ status: "closed", closedAt: when, expiresAt: when });
    expect(result.agent_hub_agent_credentials).toEqual([]);
    expect(result.agent_proposals[0]).toMatchObject({ status: "rejected", decidedAt: when });
    expect(result.opportunity_attempts[0]).toMatchObject({ leaseHash: null, leaseRunnerId: null, leaseExpiresAt: null, cancelRequested: true });
    expect(result.domain_event_deliveries[0]).toMatchObject({ status: "failed", completedAt: when });
    expect(JSON.stringify(result)).not.toContain("ciphertext");
    expect(JSON.stringify(result)).not.toContain("stored-secret");
    expect(JSON.stringify(result)).not.toContain("old-consent-hash");
    expect(JSON.stringify(result)).not.toContain('"tokenId":"token"');
  });

  it("rejects malformed profile credential bindings before removing them", () => {
    const source = rows();
    source.agent_hub_agent_credentials = [{ id: "binding", workspaceId: "workspace", tokenId: "token" }];
    expect(() => sanitizeMigrationSideEffectRows(source, when)).toThrow("Invalid agent_hub_agent_credentials.profileId");
  });
});

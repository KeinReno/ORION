import { describe, expect, it } from "vitest";
import {
  createMigrationCredentialRotationMaterial,
  sanitizeMigrationCredentialRows,
  type RiskyMigrationCredentialRows
} from "./migration-credential-sanitizer";

const when = new Date("2026-11-08T20:00:00.000Z");

function rows(): RiskyMigrationCredentialRows {
  return {
    refresh_tokens: [
      { id: "refresh-id", userId: "user-id", tokenHash: "old-refresh-hash", expiresAt: "2030-01-01T00:00:00.000Z", revokedAt: null, replacedById: "next-id" }
    ],
    agent_tokens: [
      { id: "agent-id", workspaceId: "workspace-id", createdById: "user-id", name: "Existing agent", tokenHash: "old-agent-hash", prefix: "orion_agent_abcd", scopes: ["task.write"], mode: "manager", permissions: { tasks: ["write"] }, revokedAt: null }
    ],
    workspace_invites: [
      { id: "invite-id", workspaceId: "workspace-id", invitedById: "user-id", tokenHash: "old-invite-hash", status: "pending", email: "invite@example.test", role: "member", expiresAt: "2030-01-01T00:00:00.000Z", acceptedAt: null, revokedAt: null }
    ],
    workspaces: [
      { id: "workspace-id", name: "Owned workspace", icsToken: "old-public-feed-token", syncMode: "hybrid", createdAt: "2026-01-01T00:00:00.000Z" }
    ]
  };
}

describe("migration credential sanitizer", () => {
  it("rotates bearer credentials, revokes sessions and pending invites, and preserves IDs and ownership", () => {
    const source = rows();
    const before = structuredClone(source);
    const material = createMigrationCredentialRotationMaterial(source, when);
    const result = sanitizeMigrationCredentialRows(source, material);

    expect(result.refresh_tokens[0]).toMatchObject({ id: "refresh-id", userId: "user-id", revokedAt: when.toISOString(), replacedById: null });
    expect(result.refresh_tokens[0]!.tokenHash).not.toBe("old-refresh-hash");
    expect(result.agent_tokens[0]).toMatchObject({ id: "agent-id", workspaceId: "workspace-id", createdById: "user-id", revokedAt: when.toISOString() });
    expect(result.agent_tokens[0]!.tokenHash).not.toBe("old-agent-hash");
    expect(result.agent_tokens[0]!.scopes).toEqual(["task.write"]);
    expect(result.agent_tokens[0]!.mode).toBe("manager");
    expect(result.workspace_invites[0]).toMatchObject({
      id: "invite-id", workspaceId: "workspace-id", invitedById: "user-id", status: "revoked", revokedAt: when.toISOString()
    });
    expect(result.workspace_invites[0]!.tokenHash).not.toBe("old-invite-hash");
    expect(result.workspaces[0]).toMatchObject({ id: "workspace-id", name: "Owned workspace", syncMode: "hybrid", icsToken: null });
    expect(source).toEqual(before);
    expect(JSON.stringify(result)).not.toContain("old-public-feed-token");
    expect(JSON.stringify(result)).not.toContain("old-refresh-hash");
    expect(JSON.stringify(result)).not.toContain("old-agent-hash");
    expect(JSON.stringify(result)).not.toContain("old-invite-hash");
  });

  it("uses only unique one-way hashes from cryptographic random bytes and exposes no raw secret", () => {
    const source = rows();
    const material = createMigrationCredentialRotationMaterial(source, when);
    const hashes = [...material.refreshTokenHashes, ...material.agentTokenHashes, ...material.inviteTokenHashes];
    expect(hashes).toHaveLength(3);
    expect(new Set(hashes).size).toBe(hashes.length);
    for (const hash of hashes) expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(material)).not.toContain("old-");
    expect(JSON.stringify(material)).not.toContain("orion_agent_");
  });

  it("invalidates non-pending invite hashes but preserves terminal invite state", () => {
    const original = rows();
    const source: RiskyMigrationCredentialRows = {
      ...original,
      workspace_invites: [
        { ...original.workspace_invites[0]!, status: "accepted", acceptedAt: "2026-11-01T00:00:00.000Z" },
        { ...original.workspace_invites[0]!, id: "expired-id", status: "expired" },
        { ...original.workspace_invites[0]!, id: "revoked-id", status: "revoked", revokedAt: null }
      ]
    };
    const result = sanitizeMigrationCredentialRows(source, createMigrationCredentialRotationMaterial(source, when));
    expect(result.workspace_invites.map((row) => row.status)).toEqual(["accepted", "expired", "revoked"]);
    expect(result.workspace_invites[0]!.revokedAt).toBeNull();
    expect(result.workspace_invites[1]!.revokedAt).toBeNull();
    expect(result.workspace_invites[2]!.revokedAt).toBe(when.toISOString());
    expect(new Set(result.workspace_invites.map((row) => row.tokenHash)).size).toBe(3);
  });

  it("accepts schema-valid workspaces whose nullable calendar token is already absent", () => {
    const source = rows();
    const nullableWorkspace: RiskyMigrationCredentialRows = {
      ...source,
      workspaces: [{ ...source.workspaces[0]!, icsToken: null }]
    };
    expect(sanitizeMigrationCredentialRows(nullableWorkspace, createMigrationCredentialRotationMaterial(nullableWorkspace, when)).workspaces[0]!.icsToken).toBeNull();
  });

  it("fails closed on incomplete, repeated, or source-equal rotation material without echoing secrets", () => {
    const source = rows();
    const material = createMigrationCredentialRotationMaterial(source, when);
    expect(() => sanitizeMigrationCredentialRows(source, { ...material, agentTokenHashes: [] })).toThrow("Invalid agent_tokens rotation material");
    expect(() => sanitizeMigrationCredentialRows(source, { ...material, refreshTokenHashes: ["old-refresh-hash"] })).toThrow("Invalid refresh_tokens rotation material");
    const twoInvites: RiskyMigrationCredentialRows = {
      ...source,
      workspace_invites: [source.workspace_invites[0]!, { ...source.workspace_invites[0]!, id: "second-invite-id" }]
    };
    expect(() => sanitizeMigrationCredentialRows(twoInvites, {
      ...material,
      inviteTokenHashes: [material.inviteTokenHashes[0]!, material.inviteTokenHashes[0]!]
    })).toThrow("Invalid workspace_invites rotation material");

    const missingOwner = rows();
    missingOwner.agent_tokens = [{ ...missingOwner.agent_tokens[0]!, createdById: "" }];
    const invalidMaterial = createMigrationCredentialRotationMaterial(rows(), when);
    expect(() => sanitizeMigrationCredentialRows(missingOwner, invalidMaterial)).toThrow("Invalid agent_tokens row");
    expect(() => sanitizeMigrationCredentialRows(source, { ...material, revokedAt: "not-a-date" })).toThrow("Invalid credential revocation time");
  });
});

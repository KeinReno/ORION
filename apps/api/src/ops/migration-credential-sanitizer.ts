import { createHash, randomBytes } from "node:crypto";

/**
 * A deliberately narrow, offline transformation for a few credential-bearing
 * rows in a whole-node migration draft. This is not a restore policy: callers
 * must not use it to authorize importing any other tables or relationships.
 *
 * `sanitizeMigrationCredentialRows` is deterministic for its inputs and has no
 * database, filesystem, logging, or mutation effects. Rotation material is
 * prepared separately with Node's cryptographic RNG and contains hashes only.
 */
export type MigrationCredentialRow = Readonly<Record<string, unknown>>;

export interface RiskyMigrationCredentialRows {
  refresh_tokens: readonly MigrationCredentialRow[];
  agent_tokens: readonly MigrationCredentialRow[];
  workspace_invites: readonly MigrationCredentialRow[];
  workspaces: readonly MigrationCredentialRow[];
}

export interface MigrationCredentialRotationMaterial {
  revokedAt: string;
  refreshTokenHashes: readonly string[];
  agentTokenHashes: readonly string[];
  inviteTokenHashes: readonly string[];
}

export interface SanitizedMigrationCredentialRows {
  refresh_tokens: MigrationCredentialRow[];
  agent_tokens: MigrationCredentialRow[];
  workspace_invites: MigrationCredentialRow[];
  workspaces: MigrationCredentialRow[];
}

/**
 * Creates one-way, non-credential hashes for the three hash-only token tables.
 * The raw random bytes are never returned, persisted, or logged. Workspace
 * calendar bearer tokens are cleared by the pure sanitizer rather than
 * replaced with a new active feed credential.
 */
export function createMigrationCredentialRotationMaterial(
  rows: Pick<RiskyMigrationCredentialRows, "refresh_tokens" | "agent_tokens" | "workspace_invites">,
  revokedAt: Date = new Date()
): MigrationCredentialRotationMaterial {
  if (!Number.isFinite(revokedAt.getTime())) throw new Error("Invalid credential revocation time");

  return {
    revokedAt: revokedAt.toISOString(),
    refreshTokenHashes: freshHashes(rows.refresh_tokens),
    agentTokenHashes: freshHashes(rows.agent_tokens),
    inviteTokenHashes: freshHashes(rows.workspace_invites)
  };
}

/**
 * Pure row transformation for the limited, schema-backed credential set.
 * IDs and ownership columns (`userId`, `workspaceId`, `createdById`, and
 * `invitedById`) are retained verbatim. Unrecognized/malformed rows and
 * incomplete or reused rotation material fail closed without echoing values.
 */
export function sanitizeMigrationCredentialRows(
  rows: RiskyMigrationCredentialRows,
  material: MigrationCredentialRotationMaterial
): SanitizedMigrationCredentialRows {
  assertIsoTime(material.revokedAt);
  assertReplacementHashes(rows.refresh_tokens, material.refreshTokenHashes, "refresh_tokens");
  assertReplacementHashes(rows.agent_tokens, material.agentTokenHashes, "agent_tokens");
  assertReplacementHashes(rows.workspace_invites, material.inviteTokenHashes, "workspace_invites");

  return {
    refresh_tokens: rows.refresh_tokens.map((row, index) => {
      assertRow(row, "refresh_tokens", ["id", "userId", "tokenHash"]);
      return { ...row, tokenHash: material.refreshTokenHashes[index]!, revokedAt: material.revokedAt, replacedById: null };
    }),
    agent_tokens: rows.agent_tokens.map((row, index) => {
      assertRow(row, "agent_tokens", ["id", "workspaceId", "createdById", "tokenHash"]);
      return { ...row, tokenHash: material.agentTokenHashes[index]!, revokedAt: material.revokedAt };
    }),
    workspace_invites: rows.workspace_invites.map((row, index) => {
      assertRow(row, "workspace_invites", ["id", "workspaceId", "invitedById", "tokenHash", "status"]);
      if (!["pending", "accepted", "revoked", "expired"].includes(String(row.status))) {
        throw new Error("Invalid workspace_invites status");
      }
      const revoke = row.status === "pending" || row.status === "revoked";
      return {
        ...row,
        tokenHash: material.inviteTokenHashes[index]!,
        ...(row.status === "pending" ? { status: "revoked" } : {}),
        ...(revoke ? { revokedAt: material.revokedAt } : {})
      };
    }),
    workspaces: rows.workspaces.map((row) => {
      assertRow(row, "workspaces", ["id"]);
      if (row.icsToken !== null && typeof row.icsToken !== "string") throw new Error("Invalid workspaces.icsToken");
      // A new random icsToken would immediately authorize an unauthenticated
      // calendar feed. Null revokes the old URL and leaves minting to a later,
      // explicit in-app feed-info/rotation action.
      return { ...row, icsToken: null };
    })
  };
}

function freshHashes(rows: readonly MigrationCredentialRow[]): string[] {
  const previous = new Set<string>();
  for (const row of rows) {
    assertRow(row, "credential table", ["id", "tokenHash"]);
    previous.add(row.tokenHash as string);
  }

  const generated = new Set<string>();
  return rows.map(() => {
    // Bound retries even though a collision is cryptographically negligible.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const hash = createHash("sha256").update(randomBytes(48)).digest("hex");
      if (!previous.has(hash) && !generated.has(hash)) {
        generated.add(hash);
        return hash;
      }
    }
    throw new Error("Unable to create unique credential rotation material");
  });
}

function assertReplacementHashes(
  rows: readonly MigrationCredentialRow[],
  hashes: readonly string[],
  table: string
): void {
  if (!Array.isArray(hashes) || hashes.length !== rows.length) throw new Error(`Invalid ${table} rotation material`);
  const existing = new Set<string>();
  const replacements = new Set<string>();
  for (const row of rows) {
    assertRow(row, table, ["id", "tokenHash"]);
    existing.add(row.tokenHash as string);
  }
  for (const hash of hashes) {
    if (!/^[a-f0-9]{64}$/.test(hash) || existing.has(hash) || replacements.has(hash)) {
      throw new Error(`Invalid ${table} rotation material`);
    }
    replacements.add(hash);
  }
}

function assertRow(row: MigrationCredentialRow, table: string, required: readonly string[]): void {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`Invalid ${table} row`);
  for (const field of required) {
    const value = row[field];
    if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${table} row`);
  }
}

function assertIsoTime(value: string): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("Invalid credential revocation time");
  }
}

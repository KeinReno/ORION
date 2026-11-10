import { createHash, randomBytes } from "node:crypto";

/** Rows whose background effect must not survive a one-time profile copy. */
export type MigrationSideEffectRow = Record<string, unknown>;

export interface RiskyMigrationSideEffectRows {
  sync_remotes: readonly MigrationSideEffectRow[];
  sync_devices: readonly MigrationSideEffectRow[];
  sync_restore_operations: readonly MigrationSideEffectRow[];
  health_grants: readonly MigrationSideEffectRow[];
  development_import_consents: readonly MigrationSideEffectRow[];
  extension_secrets: readonly MigrationSideEffectRow[];
  agent_hub_executions: readonly MigrationSideEffectRow[];
  agent_hub_runtime_sessions: readonly MigrationSideEffectRow[];
  agent_hub_agent_credentials: readonly MigrationSideEffectRow[];
  agent_proposals: readonly MigrationSideEffectRow[];
  opportunity_attempts: readonly MigrationSideEffectRow[];
  domain_event_deliveries: readonly MigrationSideEffectRow[];
}

const TERMINAL_EXECUTIONS = new Set(["done", "failed", "blocked", "canceled", "cancelled", "succeeded"]);
const whenText = (value: string) => value;

function assertString(row: MigrationSideEffectRow, table: string, field: string): void {
  if (typeof row[field] !== "string" || row[field] === "") throw new Error(`Invalid ${table}.${field}`);
}

/**
 * Stop credentials and in-flight work that a restored database would otherwise
 * resume. Identifiers and ownership stay. Dropped tables are access grants and
 * an unfinished restore lock: both are unsafe to replay in another profile.
 * LAN trust lives in `lan-devices.json`, not in these tables.
 */
export function sanitizeMigrationSideEffectRows(
  rows: RiskyMigrationSideEffectRows,
  deactivatedAt: string
): RiskyMigrationSideEffectRows {
  if (Number.isNaN(Date.parse(deactivatedAt))) throw new Error("Invalid deactivation time");
  for (const row of rows.agent_hub_agent_credentials) {
    assertString(row, "agent_hub_agent_credentials", "id");
    assertString(row, "agent_hub_agent_credentials", "workspaceId");
    assertString(row, "agent_hub_agent_credentials", "profileId");
  }
  return {
    sync_remotes: rows.sync_remotes.map((row) => {
      assertString(row, "sync_remotes", "id");
      assertString(row, "sync_remotes", "workspaceId");
      return {
        ...row,
        username: "",
        passwordEnc: "",
        autoEveryMs: -1,
        lastError: "После переноса удалённое хранилище отключено и требует нового пароля"
      };
    }),
    sync_devices: rows.sync_devices.map((row) => {
      assertString(row, "sync_devices", "id");
      assertString(row, "sync_devices", "userId");
      return { ...row, revokedAt: row.revokedAt ?? deactivatedAt };
    }),
    sync_restore_operations: [],
    health_grants: [],
    development_import_consents: rows.development_import_consents.map((row) => {
      assertString(row, "development_import_consents", "id");
      assertString(row, "development_import_consents", "tokenHash");
      return {
        ...row,
        tokenHash: createHash("sha256").update(randomBytes(48)).digest("hex"),
        consumedAt: row.consumedAt ?? deactivatedAt
      };
    }),
    extension_secrets: rows.extension_secrets.map((row) => {
      assertString(row, "extension_secrets", "id");
      assertString(row, "extension_secrets", "userId");
      return { ...row, valueEnc: "" };
    }),
    agent_hub_executions: rows.agent_hub_executions.map((row) => {
      assertString(row, "agent_hub_executions", "id");
      assertString(row, "agent_hub_executions", "status");
      if (TERMINAL_EXECUTIONS.has(String(row.status))) return { ...row, workerId: null, leaseUntil: null };
      return {
        ...row,
        status: "blocked",
        workerId: null,
        leaseUntil: null,
        blockedReason: "После переноса выполнение не возобновляется"
      };
    }),
    agent_hub_runtime_sessions: rows.agent_hub_runtime_sessions.map((row) => {
      assertString(row, "agent_hub_runtime_sessions", "id");
      return { ...row, status: "closed", closedAt: row.closedAt ?? deactivatedAt, expiresAt: deactivatedAt };
    }),
    // Credential bindings grant a token authority over a durable profile.
    // Do not carry that authority into a different installation; profiles and
    // task assignments are durable and remain in their own tables.
    agent_hub_agent_credentials: [],
    agent_proposals: rows.agent_proposals.map((row) => {
      assertString(row, "agent_proposals", "id");
      if (row.status !== "pending") return row;
      return { ...row, status: "rejected", decidedAt: deactivatedAt };
    }),
    opportunity_attempts: rows.opportunity_attempts.map((row) => {
      assertString(row, "opportunity_attempts", "id");
      return {
        ...row,
        leaseHash: null,
        leaseRunnerId: null,
        leaseExpiresAt: null,
        cancelRequested: row.submitReserved === true ? true : row.cancelRequested
      };
    }),
    domain_event_deliveries: rows.domain_event_deliveries.map((row) => {
      assertString(row, "domain_event_deliveries", "id");
      if (row.status !== "pending") return row;
      return {
        ...row,
        status: "failed",
        lastError: "После переноса исходящая доставка не повторяется",
        completedAt: whenText(deactivatedAt)
      };
    })
  };
}

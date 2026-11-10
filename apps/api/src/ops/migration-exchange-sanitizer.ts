import {
  publicationContentSchema,
  publicationKindSchema,
  publicationRuleConfigSchema,
  sharedGrantObjectTypeSchema
} from "@orion/shared-types";

/** Snapshot rows use JSON-compatible ISO strings for PostgreSQL timestamps. */
export type MigrationExchangeRow = Readonly<Record<string, unknown>>;

export interface RiskyMigrationExchangeRows {
  publication_rules: readonly MigrationExchangeRow[];
  shared_publications: readonly MigrationExchangeRow[];
  cross_workspace_grants: readonly MigrationExchangeRow[];
  calendar_connections: readonly MigrationExchangeRow[];
}

export interface SanitizedMigrationExchangeRows {
  publication_rules: MigrationExchangeRow[];
  shared_publications: MigrationExchangeRow[];
  cross_workspace_grants: MigrationExchangeRow[];
  calendar_connections: MigrationExchangeRow[];
}

const RULE_PAUSED_ERROR = "После переноса требуется новый предпросмотр и подтверждение";
const CALENDAR_KINDS = new Set(["ics", "caldav", "google"]);

/**
 * Pure transformation for the limited, schema-backed background exchange
 * rows. It mirrors workspace snapshot safety semantics but performs no I/O,
 * persistence, or logging. The caller supplies a single stable timestamp.
 */
export function sanitizeMigrationExchangeRows(
  rows: RiskyMigrationExchangeRows,
  deactivatedAt: string
): SanitizedMigrationExchangeRows {
  assertIsoTime(deactivatedAt, "deactivation time");

  return {
    publication_rules: rows.publication_rules.map((row) => sanitizePublicationRule(row)),
    shared_publications: rows.shared_publications.map((row) => sanitizeSharedPublication(row, deactivatedAt)),
    cross_workspace_grants: rows.cross_workspace_grants.map((row) => sanitizeCrossWorkspaceGrant(row, deactivatedAt)),
    calendar_connections: rows.calendar_connections.map((row) => sanitizeCalendarConnection(row))
  };
}

function sanitizePublicationRule(row: MigrationExchangeRow): MigrationExchangeRow {
  assertRow(row, "publication_rules", ["id", "workspaceId", "userId", "targetWorkspaceId", "config", "enabled", "revision", "history", "lastError"]);
  assertStringFields(row, "publication_rules", ["id", "workspaceId", "userId", "targetWorkspaceId"]);
  if (typeof row.enabled !== "boolean" || !isPositiveInteger(row.revision) || !Array.isArray(row.history)) {
    throw new Error("Unsupported publication_rules row");
  }
  if (row.revision === Number.MAX_SAFE_INTEGER || (row.lastError !== null && typeof row.lastError !== "string")) {
    throw new Error("Unsupported publication_rules row");
  }
  const config = publicationRuleConfigSchema.safeParse(row.config);
  if (!config.success || config.data.sourceWorkspaceId !== row.workspaceId || config.data.workspaceId !== row.targetWorkspaceId) {
    throw new Error("Unsupported publication_rules configuration");
  }
  assertRuleHistory(row.history);

  // Same reset semantics as workspace snapshots: leave audit/history intact,
  // pause every rule, invalidate optimistic revisions and require a new preview.
  return { ...row, enabled: false, revision: row.revision + 1, lastError: RULE_PAUSED_ERROR };
}

function sanitizeSharedPublication(row: MigrationExchangeRow, deactivatedAt: string): MigrationExchangeRow {
  assertRow(row, "shared_publications", [
    "id", "ruleId", "workspaceId", "publisherId", "kind", "sourceWorkspaceId", "sourceId", "sourceRevision",
    "content", "includeText", "includeDueAt", "allowStatus", "revision", "revokedAt"
  ]);
  assertStringFields(row, "shared_publications", ["id", "workspaceId", "publisherId", "sourceWorkspaceId", "sourceId"]);
  if (row.ruleId !== null && typeof row.ruleId !== "string") throw new Error("Unsupported shared_publications row");
  if (row.workspaceId === row.sourceWorkspaceId || !publicationKindSchema.safeParse(row.kind).success ||
      !isPositiveInteger(row.sourceRevision) || !isPositiveInteger(row.revision) ||
      typeof row.includeText !== "boolean" || typeof row.includeDueAt !== "boolean" || typeof row.allowStatus !== "boolean") {
    throw new Error("Unsupported shared_publications row");
  }
  const content = publicationContentSchema.safeParse(row.content);
  if (!content.success || hasUnsupportedContentKeys(row.content)) throw new Error("Unsupported shared_publications content");
  assertNullableIsoTime(row.revokedAt, "shared_publications.revokedAt");
  return { ...row, revokedAt: row.revokedAt ?? deactivatedAt };
}

function sanitizeCrossWorkspaceGrant(row: MigrationExchangeRow, deactivatedAt: string): MigrationExchangeRow {
  assertRow(row, "cross_workspace_grants", [
    "id", "workspaceId", "granterId", "granteeUserId", "objectType", "objectId", "scope", "projectionFields", "revokedAt"
  ]);
  assertStringFields(row, "cross_workspace_grants", ["id", "workspaceId", "granterId", "granteeUserId", "objectId"]);
  if (!sharedGrantObjectTypeSchema.safeParse(row.objectType).success || row.scope !== "full" ||
      !Array.isArray(row.projectionFields) || row.projectionFields.length !== 0 ||
      !row.projectionFields.every((field) => typeof field === "string")) {
    // Projection grants are modeled but not implemented. Do not guess how a
    // future scope should be transferred or activated.
    throw new Error("Unsupported cross_workspace_grants scope or object type");
  }
  assertNullableIsoTime(row.revokedAt, "cross_workspace_grants.revokedAt");
  assertNullableIsoTime(row.expiresAt, "cross_workspace_grants.expiresAt");
  if (row.revokedByUserId !== null && typeof row.revokedByUserId !== "string") {
    throw new Error("Unsupported cross_workspace_grants revocation audit");
  }
  // Matches snapshot specGrants: preserve a real prior revoke timestamp;
  // active-at-snapshot grants become inert at this supplied timestamp.
  return { ...row, revokedAt: row.revokedAt ?? deactivatedAt };
}

function sanitizeCalendarConnection(row: MigrationExchangeRow): MigrationExchangeRow {
  assertRow(row, "calendar_connections", [
    "id", "workspaceId", "name", "kind", "url", "username", "passwordEnc", "color", "enabled", "lastSyncAt", "lastError", "createdAt", "updatedAt"
  ]);
  assertStringFields(row, "calendar_connections", ["id", "workspaceId"]);
  if (typeof row.enabled !== "boolean" || !CALENDAR_KINDS.has(String(row.kind)) ||
      typeof row.passwordEnc !== "string" || typeof row.name !== "string" ||
      typeof row.url !== "string" || typeof row.username !== "string" ||
      (row.color !== null && typeof row.color !== "string") ||
      (row.lastError !== null && typeof row.lastError !== "string")) {
    throw new Error("Unsupported calendar_connections row");
  }
  assertNullableIsoTime(row.lastSyncAt, "calendar_connections.lastSyncAt");
  assertIsoTime(row.createdAt, "calendar_connections.createdAt");
  assertIsoTime(row.updatedAt, "calendar_connections.updatedAt");
  let url: URL;
  try {
    url = new URL(row.url);
  } catch {
    throw new Error("Unsupported calendar_connections URL");
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("Unsupported calendar_connections URL");

  // The persisted sync worker enumerates only enabled rows. Keep the source
  // configuration and last-sync audit fields but never restart a feed pull.
  return { ...row, enabled: false };
}

function assertRuleHistory(value: unknown): void {
  if (!Array.isArray(value)) throw new Error("Unsupported publication_rules history");
  const allowedActions = new Set(["created", "edited", "enabled", "paused", "processed", "blocked", "failed"]);
  for (const item of value) {
    if (!isRecord(item) || typeof item.at !== "string" || !allowedActions.has(String(item.action))) {
      throw new Error("Unsupported publication_rules history");
    }
    assertIsoTime(item.at, "publication_rules history timestamp");
    if (item.fingerprint !== undefined && typeof item.fingerprint !== "string") throw new Error("Unsupported publication_rules history");
    if (item.consentFutureRecords !== undefined && item.consentFutureRecords !== true) throw new Error("Unsupported publication_rules history");
    for (const counter of ["published", "updated", "withdrawn"]) {
      if (item[counter] !== undefined && !Number.isSafeInteger(item[counter])) throw new Error("Unsupported publication_rules history");
    }
  }
}

function hasUnsupportedContentKeys(value: unknown): boolean {
  if (!isRecord(value)) return true;
  return Object.keys(value).some((key) => !["title", "text", "status", "dueAt"].includes(key));
}

function assertRow(row: MigrationExchangeRow, table: string, required: readonly string[]): void {
  if (!isRecord(row)) throw new Error(`Unsupported ${table} row`);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) throw new Error(`Unsupported ${table} row`);
  }
}

function assertStringFields(row: MigrationExchangeRow, table: string, fields: readonly string[]): void {
  for (const field of fields) {
    const value = row[field];
    if (typeof value !== "string" || value.length === 0) throw new Error(`Unsupported ${table} row`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function assertNullableIsoTime(value: unknown, field: string): void {
  if (value === null) return;
  assertIsoTime(value, field);
}

function assertIsoTime(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`Unsupported ${field}`);
  try {
    if (new Date(value).toISOString() !== value) throw new Error(`Unsupported ${field}`);
  } catch {
    throw new Error(`Unsupported ${field}`);
  }
}

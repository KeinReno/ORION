import { createHash } from "node:crypto";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { verifyNodeBackupIntegrity } from "./backup-integrity";
import {
  createMigrationCredentialRotationMaterial,
  sanitizeMigrationCredentialRows,
  type RiskyMigrationCredentialRows
} from "./migration-credential-sanitizer";
import {
  sanitizeMigrationExchangeRows,
  type RiskyMigrationExchangeRows
} from "./migration-exchange-sanitizer";
import {
  sanitizeMigrationSideEffectRows,
  type RiskyMigrationSideEffectRows
} from "./migration-side-effect-sanitizer";

const MOD = 1n << 256n;
const CREDENTIAL_TABLES = ["refresh_tokens", "agent_tokens", "workspace_invites", "workspaces"] as const;
const EXCHANGE_TABLES = ["publication_rules", "shared_publications", "cross_workspace_grants", "calendar_connections"] as const;
const SIDE_EFFECT_TABLES = [
  "sync_remotes", "sync_devices", "sync_restore_operations", "health_grants",
  "development_import_consents", "extension_secrets", "agent_hub_executions",
  "agent_hub_runtime_sessions", "agent_proposals", "opportunity_attempts", "domain_event_deliveries"
] as const;

export interface MigrationStageReport {
  tablesRewritten: string[];
  credentialsRotated: number;
  exchangesPaused: number;
  sideEffectsStopped: number;
  syncSecretFingerprintCleared: true;
  jwtSecret: "absent-from-backup";
  lanDevices: "absent-from-backup";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertIsolatedDestination(destination: string): void {
  const resolved = path.resolve(destination).toLowerCase();
  const local = process.env.LOCALAPPDATA;
  const program = process.env.ProgramData ?? "C:\\ProgramData";
  const forbidden = [local ? path.join(local, "ORION") : "", path.join(program, "ORION")]
    .filter(Boolean)
    .map((dir) => path.resolve(dir).toLowerCase());
  if (forbidden.some((dir) => resolved === dir || resolved.startsWith(`${dir}${path.sep}`)) || resolved.includes("com.orion.desktop")) {
    throw new Error("classic_profile_refused");
  }
}

async function readRows(file: string): Promise<Record<string, unknown>[]> {
  const body = await readFile(file, "utf8");
  if (body === "") return [];
  return body.split("\n").slice(0, -1).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function encodeRows(rows: readonly Record<string, unknown>[]): { body: string; rows: number; fileSha256: string; rowsDigest: string } {
  const lines = rows.map((row) => JSON.stringify(row));
  const body = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  let sum = 0n;
  for (const line of lines) sum = (sum + BigInt(`0x${sha256(line)}`)) % MOD;
  return { body, rows: lines.length, fileSha256: sha256(body), rowsDigest: sum.toString(16).padStart(64, "0") };
}

/**
 * Copy a verified whole-node backup and rewrite the known credential and
 * exchange tables before any database restore. The source directory is only
 * read. The copy is still not authorized to start background jobs: callers
 * restore it into an empty isolated database and keep the API stopped until
 * the resulting rows are checked.
 */
export async function stageSanitizedMigration(source: string, destination: string, now = new Date()): Promise<MigrationStageReport> {
  const sourceRoot = path.resolve(source);
  const destinationRoot = path.resolve(destination);
  if (sourceRoot.toLowerCase() === destinationRoot.toLowerCase()) throw new Error("stage_must_be_a_copy");
  assertIsolatedDestination(destinationRoot);
  const checked = await verifyNodeBackupIntegrity(sourceRoot);
  if (checked.status !== "integrity-verified") throw new Error("source_backup_invalid");
  await cp(sourceRoot, destinationRoot, { recursive: true, errorOnExist: true });

  const manifestPath = path.join(destinationRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    tables: Record<string, { rows: number; fileSha256: string; rowsDigest: string }>;
    secrets?: { SYNC_SECRET?: string | null };
  };
  if (manifest.secrets) manifest.secrets.SYNC_SECRET = null;
  const present = new Set(Object.keys(manifest.tables));
  const credentialNames = CREDENTIAL_TABLES.filter((name) => present.has(name));
  const exchangeNames = EXCHANGE_TABLES.filter((name) => present.has(name));
  const tablesDir = path.join(destinationRoot, "tables");
  const credentials: RiskyMigrationCredentialRows = {
    refresh_tokens: [],
    agent_tokens: [],
    workspace_invites: [],
    workspaces: []
  };
  for (const name of credentialNames) {
    credentials[name] = await readRows(path.join(tablesDir, `${name}.ndjson`));
  }
  const material = createMigrationCredentialRotationMaterial(credentials, now);
  const sanitizedCredentials = sanitizeMigrationCredentialRows(credentials, material);
  for (const name of credentialNames) {
    const encoded = encodeRows(sanitizedCredentials[name]);
    await writeFile(path.join(tablesDir, `${name}.ndjson`), encoded.body, "utf8");
    manifest.tables[name] = { rows: encoded.rows, fileSha256: encoded.fileSha256, rowsDigest: encoded.rowsDigest };
  }

  const exchanges: RiskyMigrationExchangeRows = {
    publication_rules: [],
    shared_publications: [],
    cross_workspace_grants: [],
    calendar_connections: []
  };
  for (const name of exchangeNames) {
    exchanges[name] = await readRows(path.join(tablesDir, `${name}.ndjson`));
  }
  const sanitizedExchanges = sanitizeMigrationExchangeRows(exchanges, now.toISOString());
  for (const name of exchangeNames) {
    const encoded = encodeRows(sanitizedExchanges[name]);
    await writeFile(path.join(tablesDir, `${name}.ndjson`), encoded.body, "utf8");
    manifest.tables[name] = { rows: encoded.rows, fileSha256: encoded.fileSha256, rowsDigest: encoded.rowsDigest };
  }

  const sideNames = SIDE_EFFECT_TABLES.filter((name) => present.has(name));
  const sideEffects: RiskyMigrationSideEffectRows = {
    sync_remotes: [], sync_devices: [], sync_restore_operations: [], health_grants: [],
    development_import_consents: [], extension_secrets: [], agent_hub_executions: [],
    agent_hub_runtime_sessions: [], agent_proposals: [], opportunity_attempts: [], domain_event_deliveries: []
  };
  for (const name of sideNames) sideEffects[name] = await readRows(path.join(tablesDir, `${name}.ndjson`));
  const sanitizedSideEffects = sanitizeMigrationSideEffectRows(sideEffects, now.toISOString());
  for (const name of sideNames) {
    const encoded = encodeRows(sanitizedSideEffects[name]);
    await writeFile(path.join(tablesDir, `${name}.ndjson`), encoded.body, "utf8");
    manifest.tables[name] = { rows: encoded.rows, fileSha256: encoded.fileSha256, rowsDigest: encoded.rowsDigest };
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const staged = await verifyNodeBackupIntegrity(destinationRoot);
  if (staged.status !== "integrity-verified") throw new Error("staged_backup_invalid");
  return {
    tablesRewritten: [...credentialNames, ...exchangeNames, ...sideNames],
    credentialsRotated: material.refreshTokenHashes.length + material.agentTokenHashes.length + material.inviteTokenHashes.length,
    exchangesPaused: exchangeNames.reduce((sum, name) => sum + sanitizedExchanges[name].length, 0),
    sideEffectsStopped: sideNames.reduce((sum, name) => sum + sideEffects[name].length, 0),
    syncSecretFingerprintCleared: true,
    jwtSecret: "absent-from-backup",
    lanDevices: "absent-from-backup"
  };
}

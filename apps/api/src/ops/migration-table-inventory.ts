import { Prisma } from "@prisma/client";
import { SNAPSHOT_MODEL_REGISTRY, type SnapshotPolicy } from "../sync/snapshot-registry";

export type MigrationTableDisposition = "preserve" | "sanitize-credentials" | "sanitize-exchanges" | "sanitize-side-effects";

export interface MigrationTableInventory {
  status: "classified" | "blocked";
  tablesSeen: number;
  modelsExpected: number;
  unknownTables: number;
  missingTables: number;
  ambiguousModels: number;
  unparsedPolicies: number;
  tablesWithMigrationDisposition: number;
  tablesWithoutMigrationDisposition: number;
  dispositions: Record<MigrationTableDisposition, number>;
  restoreAuthorized: false;
}

interface ModelIdentity {
  name: string;
  dbName?: string | null;
}

interface ModelPolicy {
  model: string;
  policy: string;
}

const SNAPSHOT_POLICIES = new Set<SnapshotPolicy>([
  "included", "derived", "identity-excluded", "secret-excluded", "ephemeral-excluded"
]);

const MIGRATION_DISPOSITIONS: Record<MigrationTableDisposition, ReadonlySet<string>> = {
  // Durable Agent Hub identity and assignment intent survive a profile move.
  // The append-only run journal is retained as historical evidence.
  preserve: new Set([
    "agent_hub_events", "agent_hub_agent_profiles", "agent_hub_task_assignments",
    "development_architect_snapshots", "development_workflows"
  ]),
  "sanitize-credentials": new Set(["refresh_tokens", "agent_tokens", "workspace_invites", "workspaces"]),
  "sanitize-exchanges": new Set(["publication_rules", "shared_publications", "cross_workspace_grants", "calendar_connections"]),
  "sanitize-side-effects": new Set([
    "sync_remotes", "sync_devices", "sync_restore_operations", "health_grants",
    "development_import_consents", "extension_secrets", "agent_hub_executions",
    "agent_hub_runtime_sessions", "agent_hub_agent_credentials",
    "agent_proposals", "opportunity_attempts", "domain_event_deliveries"
  ])
};

/**
 * Diagnostic inventory only: existing snapshot classifications are parsed
 * but never treated as permission to restore. An incomplete report means a
 * migration policy decision is still required; this helper is not a gate.
 */
export function inspectMigrationTableInventory(
  tableNames: readonly string[],
  models: readonly ModelIdentity[] = Prisma.dmmf.datamodel.models.map((model) => ({ name: model.name, dbName: model.dbName })),
  modelPolicies: readonly ModelPolicy[] = SNAPSHOT_MODEL_REGISTRY
): MigrationTableInventory {
  const modelTables = new Map<string, string[]>();
  for (const model of models) {
    const table = model.dbName ?? model.name;
    const names = modelTables.get(table) ?? [];
    names.push(model.name);
    modelTables.set(table, names);
  }

  const policiesByModel = new Map<string, string[]>();
  for (const entry of modelPolicies) {
    const policies = policiesByModel.get(entry.model) ?? [];
    policies.push(entry.policy);
    policiesByModel.set(entry.model, policies);
  }

  let ambiguousModels = 0;
  let unparsedPolicies = 0;
  let tablesWithMigrationDisposition = 0;
  let tablesWithoutMigrationDisposition = 0;
  const dispositions: Record<MigrationTableDisposition, number> = {
    preserve: 0,
    "sanitize-credentials": 0,
    "sanitize-exchanges": 0,
    "sanitize-side-effects": 0
  };

  for (const names of modelTables.values()) {
    if (names.length !== 1) ambiguousModels += 1;
    for (const model of names) {
      const policies = policiesByModel.get(model) ?? [];
      if (policies.length !== 1 || !SNAPSHOT_POLICIES.has(policies[0] as SnapshotPolicy)) unparsedPolicies += 1;
    }
  }

  const seen = new Set<string>();
  let unknownTables = 0;
  for (const table of tableNames) {
    if (seen.has(table)) {
      unknownTables += 1;
      continue;
    }
    seen.add(table);
    const modelsForTable = modelTables.get(table);
    if (!modelsForTable || modelsForTable.length !== 1) {
      unknownTables += 1;
      continue;
    }
    const disposition = (Object.keys(MIGRATION_DISPOSITIONS) as MigrationTableDisposition[])
      .find((candidate) => MIGRATION_DISPOSITIONS[candidate].has(table));
    if (disposition) {
      dispositions[disposition] += 1;
      tablesWithMigrationDisposition += 1;
    } else {
      // Do not guess that pass-through rows are content-only or permission-free.
      tablesWithoutMigrationDisposition += 1;
    }
  }

  const missingTables = [...modelTables.keys()].filter((table) => !seen.has(table)).length;
  const status = unknownTables === 0 && missingTables === 0 && ambiguousModels === 0 &&
    unparsedPolicies === 0 && tablesWithoutMigrationDisposition === 0
    ? "classified"
    : "blocked";

  return {
    status,
    tablesSeen: tableNames.length,
    modelsExpected: models.length,
    unknownTables,
    missingTables,
    ambiguousModels,
    unparsedPolicies,
    tablesWithMigrationDisposition,
    tablesWithoutMigrationDisposition,
    dispositions,
    restoreAuthorized: false
  };
}


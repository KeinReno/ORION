import { Prisma } from "@prisma/client";
import { SNAPSHOT_MODEL_REGISTRY, type SnapshotPolicy } from "../sync/snapshot-registry";

const SNAPSHOT_POLICIES: readonly SnapshotPolicy[] = [
  "included",
  "derived",
  "identity-excluded",
  "secret-excluded",
  "ephemeral-excluded"
];

export interface WholeNodeSnapshotInventory {
  status: "classified" | "unknown-tables";
  tablesSeen: number;
  categories: Record<SnapshotPolicy, number>;
  unknown: number;
  restoreAuthorized: false;
  notice: string;
}

interface DmmfModelIdentity {
  name: string;
  dbName?: string | null;
}

/**
 * Classifies table names from a whole-node manifest against the current Prisma
 * schema and the workspace snapshot registry. It never reads row data or
 * changes the backup. Workspace snapshot policy is inventory only and cannot
 * authorize a whole-node restore.
 */
export function classifyWholeNodeManifestTables(tableNames: readonly string[]): WholeNodeSnapshotInventory {
  const dmmfModels: DmmfModelIdentity[] = Prisma.dmmf.datamodel.models.map((model) => ({ name: model.name, dbName: model.dbName }));
  return classifyTablesAgainstRegistry(tableNames, dmmfModels, SNAPSHOT_MODEL_REGISTRY);
}

function classifyTablesAgainstRegistry(
  tableNames: readonly string[],
  dmmfModels: readonly DmmfModelIdentity[],
  registry: readonly { model: string; policy: SnapshotPolicy }[]
): WholeNodeSnapshotInventory {
  const categories = Object.fromEntries(SNAPSHOT_POLICIES.map((policy) => [policy, 0])) as Record<SnapshotPolicy, number>;
  const registryByModel = new Map<string, SnapshotPolicy[]>();
  for (const entry of registry) {
    const policies = registryByModel.get(entry.model) ?? [];
    policies.push(entry.policy);
    registryByModel.set(entry.model, policies);
  }

  const modelsByTable = new Map<string, string[]>();
  for (const model of dmmfModels) {
    const table = model.dbName ?? model.name;
    const models = modelsByTable.get(table) ?? [];
    models.push(model.name);
    modelsByTable.set(table, models);
  }

  let unknown = 0;
  const seen = new Set<string>();
  for (const table of tableNames) {
    if (seen.has(table)) {
      unknown += 1;
      continue;
    }
    seen.add(table);
    const models = modelsByTable.get(table);
    if (!models || models.length !== 1) {
      unknown += 1;
      continue;
    }
    const policies = registryByModel.get(models[0]!);
    if (!policies || policies.length !== 1 || !SNAPSHOT_POLICIES.includes(policies[0]!)) {
      unknown += 1;
      continue;
    }
    categories[policies[0]!] += 1;
  }

  return {
    status: unknown === 0 ? "classified" : "unknown-tables",
    tablesSeen: tableNames.length,
    categories,
    unknown,
    restoreAuthorized: false,
    notice: "Классификация workspace snapshot — только инвентаризация; она не подтверждает безопасность или готовность whole-node restore и не разрешает его."
  };
}

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { compareMigrationFiles, type MigrationCompatibility } from "./migration-compatibility";
import { classifyWholeNodeManifestTables, type WholeNodeSnapshotInventory } from "./whole-node-snapshot-inventory";

// This only reads a backup manifest. Counts are claims in that manifest, not
// evidence of integrity, a consistent snapshot, or permission to restore it.
const manifestSchema = z.object({
  version: z.literal(1),
  createdAt: z.string().min(1),
  migrations: z.array(z.string().min(1)),
  tables: z.record(z.string(), z.object({ rows: z.number().int().nonnegative().safe() })),
  storage: z.object({ driver: z.string().min(1), files: z.array(z.unknown()) })
});

export interface MigrationPreflightReport {
  status: "inspection-only";
  source: { createdAt: string; migrationCount: number; tableCount: number; documentFileCount: number; storageDriver: string };
  claimedCounts: Record<"users" | "workspaces" | "projects" | "tasks" | "notes" | "documents", number | null>;
  migrationFiles: MigrationCompatibility | null;
  snapshotInventory: WholeNodeSnapshotInventory;
  blockers: string[];
}

export async function inspectMigrationBackup(directory: string, migrationDirectory?: string): Promise<MigrationPreflightReport> {
  const file = path.join(directory, "manifest.json");
  const info = await stat(file);
  if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error("Манифест отсутствует или превышает допустимый размер.");
  const body = await readFile(file, "utf8");
  if (Buffer.byteLength(body, "utf8") > 16 * 1024 * 1024) throw new Error("Манифест превышает допустимый размер.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // JSON.parse errors may contain an excerpt of the input, including secrets.
    throw new Error("Неподдерживаемый или повреждённый манифест резервной копии.");
  }
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) throw new Error("Неподдерживаемый или повреждённый манифест резервной копии.");
  const manifest = result.data;
  const count = (table: string): number | null => manifest.tables[table]?.rows ?? null;
  return {
    status: "inspection-only",
    source: {
      createdAt: manifest.createdAt,
      migrationCount: manifest.migrations.length,
      tableCount: Object.keys(manifest.tables).length,
      documentFileCount: manifest.storage.files.length,
      storageDriver: manifest.storage.driver
    },
    claimedCounts: {
      users: count("users"), workspaces: count("workspaces"), projects: count("projects"),
      tasks: count("tasks"), notes: count("notes"), documents: count("documents")
    },
    migrationFiles: migrationDirectory ? await compareMigrationFiles(manifest.migrations, migrationDirectory) : null,
    snapshotInventory: classifyWholeNodeManifestTables(Object.keys(manifest.tables)),
    blockers: [
      "Контрольные суммы и полнота резервной копии не проверены.",
      "Совместимость миграций с целевой установкой не проверена.",
      "Согласованность снимка базы и файлов не подтверждена.",
      "Очистка сессий, полномочий и внешних подключений не выполнена.",
      "Изолированный целевой профиль, проверка и откат ещё не реализованы."
    ]
  };
}

import "dotenv/config";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createNodeBackup, restoreNodeBackup, verifyNodeBackup } from "./node-backup";
import { inspectMigrationBackup } from "./migration-preflight";
import { verifyNodeBackupIntegrity } from "./backup-integrity";

/**
 * Operator commands for a whole-node backup (see node-backup.ts):
 *
 *   node dist/ops/cli.js backup  <dir>   DB + document files + manifest into an empty <dir>
 *   node dist/ops/cli.js verify  <dir>   offline checksum check, no database needed
 *   node dist/ops/cli.js restore <dir>   into an EMPTY, already migrated database and an empty STORAGE_DIR
 *
 * Uses DATABASE_URL (the migration role), never APP_DATABASE_URL: the app role
 * is bound by RLS and cannot read or restore across workspaces.
 */
function storageDir(): string {
  const configured = process.env.STORAGE_DIR?.trim();
  return path.resolve(configured && configured.length > 0 ? configured : path.join(process.cwd(), ".data", "documents"));
}

async function main(): Promise<void> {
  const [command, dirArg, migrationDir] = process.argv.slice(2);
  if (!command || !dirArg || !["backup", "verify", "restore", "inspect-migration", "verify-migration"].includes(command)) {
    console.error("Использование: node dist/ops/cli.js <backup|verify|restore|inspect-migration|verify-migration> <каталог>");
    process.exitCode = 2;
    return;
  }
  const dir = path.resolve(dirArg);

  if (command === "inspect-migration") {
    console.log(JSON.stringify(await inspectMigrationBackup(dir, migrationDir ? path.resolve(migrationDir) : undefined), null, 2));
    return;
  }

  if (command === "verify-migration") {
    const report = await verifyNodeBackupIntegrity(dir);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "integrity-verified") process.exitCode = 1;
    return;
  }

  if (command === "verify") {
    const problems = await verifyNodeBackup(dir);
    if (problems.length > 0) {
      console.error(`Копия повреждена:\n- ${problems.join("\n- ")}`);
      process.exitCode = 1;
      return;
    }
    console.log("Копия цела: контрольные суммы таблиц и файлов совпали.");
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан (нужна роль миграций, не orion_app).");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    if (command === "backup") {
      const manifest = await createNodeBackup(prisma, {
        outDir: dir,
        storageDir: storageDir(),
        storageDriver: process.env.STORAGE_DRIVER,
        syncSecret: process.env.SYNC_SECRET
      });
      const rows = Object.values(manifest.tables).reduce((sum, table) => sum + table.rows, 0);
      console.log(`Копия готова: ${Object.keys(manifest.tables).length} таблиц, ${rows} строк, ${manifest.storage.files.length} файлов → ${dir}`);
      console.log("Сохраните отдельно JWT_SECRET и SYNC_SECRET: в копию они не входят. Каталог содержит данные всех пользователей — храните его как саму БД.");
    } else {
      const report = await restoreNodeBackup(prisma, { dir, storageDir: storageDir(), syncSecret: process.env.SYNC_SECRET });
      console.log(`Восстановлено: ${report.tables} таблиц, ${report.rows} строк, ${report.files} файлов; суммы и ссылки сверены.`);
      for (const warning of report.warnings) console.warn(`ПРЕДУПРЕЖДЕНИЕ: ${warning}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

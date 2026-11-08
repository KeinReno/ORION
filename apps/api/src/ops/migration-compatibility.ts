import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

export interface MigrationCompatibility {
  scope: "backup-manifest-vs-migration-files";
  status: "match" | "mismatch";
  sourceCount: number;
  targetCount: number;
  onlyInSource: number;
  onlyInTarget: number;
}

/** Compares names only. It does not establish target DB state or SQL content. */
export async function compareMigrationFiles(source: string[], targetDirectory: string): Promise<MigrationCompatibility> {
  if (new Set(source).size !== source.length || source.some((name) => !/^[0-9]{14}_[A-Za-z0-9_]+$/.test(name))) {
    throw new Error("Манифест содержит некорректный список миграций.");
  }
  const entries = await readdir(targetDirectory, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.name === "migration_lock.toml" && entry.isFile()) continue;
    if (!entry.isDirectory() || !/^[0-9]{14}_[A-Za-z0-9_]+$/.test(entry.name)) {
      throw new Error("Каталог миграций содержит неподдерживаемый элемент.");
    }
    const migration = await lstat(path.join(targetDirectory, entry.name, "migration.sql"));
    if (!migration.isFile() || migration.isSymbolicLink()) throw new Error("Файл миграции недоступен или является ссылкой.");
    names.push(entry.name);
  }
  if (names.length === 0) throw new Error("Каталог миграций пуст.");
  const sourceSet = new Set(source);
  const targetSet = new Set(names);
  const onlyInSource = source.filter((name) => !targetSet.has(name)).length;
  const onlyInTarget = names.filter((name) => !sourceSet.has(name)).length;
  return {
    scope: "backup-manifest-vs-migration-files",
    status: onlyInSource === 0 && onlyInTarget === 0 ? "match" : "mismatch",
    sourceCount: source.length, targetCount: names.length, onlyInSource, onlyInTarget
  };
}

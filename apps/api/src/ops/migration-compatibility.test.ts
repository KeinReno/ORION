import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { compareMigrationFiles } from "./migration-compatibility";

const dirs: string[] = [];
const first = "20260904185902_init";
const second = "20260905111036_add_tasks";
async function target(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "orion-migrations-"));
  dirs.push(root);
  await mkdir(path.join(root, first));
  await writeFile(path.join(root, first, "migration.sql"), "SELECT 1;");
  await writeFile(path.join(root, "migration_lock.toml"), 'provider = "postgresql"');
  return root;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

it("compares backup names with build files but makes no claim about database state", async () => {
  const dir = await target();
  expect(await compareMigrationFiles([first], dir)).toMatchObject({ scope: "backup-manifest-vs-migration-files", status: "match" });
  expect(await compareMigrationFiles([second], dir)).toMatchObject({ status: "mismatch", onlyInSource: 1, onlyInTarget: 1 });
});

it("rejects duplicates, malformed names and incomplete migration directories", async () => {
  const dir = await target();
  await expect(compareMigrationFiles([first, first], dir)).rejects.toThrow(/некорректный/);
  await expect(compareMigrationFiles(["../secret"], dir)).rejects.toThrow(/некорректный/);
  await mkdir(path.join(dir, second));
  await expect(compareMigrationFiles([first], dir)).rejects.toThrow();
});

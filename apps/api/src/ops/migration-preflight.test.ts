import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectMigrationBackup } from "./migration-preflight";

const directories: string[] = [];
async function fixture(manifest: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "orion-preflight-"));
  directories.push(dir);
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const valid = {
  version: 1, createdAt: "2026-11-08T00:00:00Z", migrations: ["one"],
  tables: { users: { rows: 2 }, tasks: { rows: 3 } },
  storage: { driver: "local", files: [{ path: "private.txt" }] },
  secrets: { SYNC_SECRET: "do-not-report" }
};

describe("offline migration inspection", () => {
  it("reports unverified counts and blockers without touching the backup or exposing secrets", async () => {
    const dir = await fixture(valid);
    const before = await readFile(path.join(dir, "manifest.json"));
    const report = await inspectMigrationBackup(dir);
    expect(report.status).toBe("inspection-only");
    expect(report.claimedCounts).toMatchObject({ users: 2, tasks: 3, projects: null });
    expect(report.source.documentFileCount).toBe(1);
    expect(report.snapshotInventory.restoreAuthorized).toBe(false);
    expect(report.blockers.length).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain("do-not-report");
    expect(JSON.stringify(report)).not.toContain("private.txt");
    expect(await readFile(path.join(dir, "manifest.json"))).toEqual(before);
  });

  it.each([
    { ...valid, version: 2 },
    { ...valid, tables: { users: { rows: -1 } } },
    { ...valid, storage: { driver: "", files: [] } },
    { ...valid, migrations: "not-a-list" }
  ])("rejects invalid manifest metadata", async (manifest) => {
    await expect(inspectMigrationBackup(await fixture(manifest))).rejects.toThrow(/манифест/i);
  });

  it("does not echo malformed manifest content in errors", async () => {
    const dir = await fixture(valid);
    await writeFile(path.join(dir, "manifest.json"), "not-json-secret-value");
    const message = await inspectMigrationBackup(dir).catch((error: Error) => error.message);
    expect(message).toMatch(/манифест/i);
    expect(message).not.toContain("secret-value");
  });
});

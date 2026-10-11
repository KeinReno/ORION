import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNodeBackup, findOrphans, restoreNodeBackup, secretFingerprint, verifyNodeBackup } from "../src/ops/node-backup";

/**
 * Release gate "Данные и откат": a whole node (every table + document files) is
 * backed up from a live database and restored into an EMPTY, freshly migrated one,
 * and the result must be byte-for-byte the same rows and files.
 */
const suffix = randomUUID().slice(0, 8);
const targetName = `orion_restore_test_${suffix}`;
const sourceUrl = process.env.DATABASE_URL!;
const targetUrl = sourceUrl.replace(/\/([^/?]+)(\?.*)?$/, `/${targetName}$2`);
const adminUrl = sourceUrl.replace(/\/([^/?]+)(\?.*)?$/, "/postgres$2");

const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
let target: PrismaClient;
let scratch: string;
let userId: string;
let workspaceId: string;

function migrate(url: string): void {
  const cli = require.resolve("prisma/build/index.js");
  execFileSync(process.execPath, [cli, "migrate", "deploy"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe"
  });
}

beforeAll(async () => {
  scratch = mkdtempSync(path.join(tmpdir(), "orion-node-backup-"));
  await admin.$executeRawUnsafe(`CREATE DATABASE "${targetName}"`);
  migrate(targetUrl);
  target = new PrismaClient({ datasources: { db: { url: targetUrl } } });

  const user = await source.user.create({ data: { email: `backup-${suffix}@example.test`, name: "Backup Test", passwordHash: "argon2-hash-placeholder" } });
  userId = user.id;
  const workspace = await source.workspace.create({ data: { name: `Backup ${suffix}` } });
  workspaceId = workspace.id;
  await source.workspaceMember.create({ data: { workspaceId, userId, role: "owner" } });
  const parent = await source.task.create({ data: { workspaceId, title: "Родительская задача" } });
  await source.task.create({ data: { workspaceId, title: "Подзадача", parentId: parent.id } });
  await source.note.create({ data: { workspaceId, title: "Заметка", body: "Тело с \"кавычками\", переводом\nстроки и юникодом ✓" } });
  await source.document.create({ data: { workspaceId, kind: "folder", name: "Папка" } });
}, 180_000);

afterAll(async () => {
  // Cascade removes the workspace's rows; the user goes with its membership.
  await source.workspace.deleteMany({ where: { id: workspaceId } });
  await source.user.deleteMany({ where: { id: userId } });
  await target?.$disconnect();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${targetName}" WITH (FORCE)`);
  await Promise.all([source.$disconnect(), admin.$disconnect()]);
  rmSync(scratch, { recursive: true, force: true });
}, 60_000);

describe("whole-node backup and restore", () => {
  it("rebuilds an empty node with identical rows and files", async () => {
    const storage = path.join(scratch, "storage-src");
    mkdirSync(path.join(storage, workspaceId, "Папка"), { recursive: true });
    const content = Buffer.from("содержимое файла\u0000с бинарным нулём", "utf8");
    writeFileSync(path.join(storage, workspaceId, "Папка", "файл.bin"), content);

    const backupDir = path.join(scratch, "backup");
    const manifest = await createNodeBackup(source, { outDir: backupDir, storageDir: storage, syncSecret: "test-sync-key" });
    expect(manifest.tables["users"]!.rows).toBeGreaterThan(0);
    expect(manifest.storage.files.map((file) => file.path)).toContain(`${workspaceId}/Папка/файл.bin`);
    expect(await verifyNodeBackup(backupDir)).toEqual([]);

    const restoredStorage = path.join(scratch, "storage-restored");
    const report = await restoreNodeBackup(target, { dir: backupDir, storageDir: restoredStorage, syncSecret: "test-sync-key" });
    expect(report.warnings).toEqual([]);
    expect(report.tables).toBe(Object.keys(manifest.tables).length);
    expect(readFileSync(path.join(restoredStorage, workspaceId, "Папка", "файл.bin"))).toEqual(content);

    // Rows came across verbatim, including the self-referencing task and the numbered note.
    const restoredTasks = await target.task.findMany({ where: { workspaceId }, orderBy: { title: "asc" } });
    expect(restoredTasks.map((task) => task.title)).toEqual(["Подзадача", "Родительская задача"]);
    expect(restoredTasks[0]!.parentId).toBe(restoredTasks[1]!.id);
    const sourceNote = await source.note.findFirstOrThrow({ where: { workspaceId } });
    const restoredNote = await target.note.findFirstOrThrow({ where: { workspaceId } });
    expect(restoredNote.number).toBe(sourceNote.number);
    expect(restoredNote.body).toBe(sourceNote.body);
    expect((await target.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash).toBe("argon2-hash-placeholder");
    expect(await findOrphans(target)).toEqual([]);
  }, 180_000);

  it("refuses to restore over a node that already has data", async () => {
    const backupDir = path.join(scratch, "backup");
    await expect(restoreNodeBackup(target, { dir: backupDir, storageDir: path.join(scratch, "storage-again") })).rejects.toThrow(/не пуст/);
  });

  it("detects a tampered or truncated backup before touching the database", async () => {
    const backupDir = path.join(scratch, "backup");
    const file = path.join(backupDir, "tables", "tasks.ndjson");
    const original = readFileSync(file, "utf8");
    writeFileSync(file, `${original}{"id":"forged"}\n`);
    try {
      expect((await verifyNodeBackup(backupDir)).join()).toMatch(/tasks/);
      await expect(restoreNodeBackup(target, { dir: backupDir, storageDir: path.join(scratch, "storage-tampered") })).rejects.toThrow(/повреждена/);
    } finally {
      writeFileSync(file, original);
    }
  });

  it("warns when the sync key differs, because stored remote passwords would not decrypt", async () => {
    const empty = `orion_restore_warn_${suffix}`;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${empty}"`);
    const url = sourceUrl.replace(/\/([^/?]+)(\?.*)?$/, `/${empty}$2`);
    let fresh: PrismaClient | undefined;
    try {
      migrate(url);
      fresh = new PrismaClient({ datasources: { db: { url } } });
      const report = await restoreNodeBackup(fresh, { dir: path.join(scratch, "backup"), storageDir: path.join(scratch, "storage-warn"), syncSecret: "another-key" });
      expect(report.warnings.join()).toMatch(/SYNC_SECRET/);
    } finally {
      await fresh?.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${empty}" WITH (FORCE)`);
    }
  }, 180_000);

  it("fingerprints secrets without exposing them", () => {
    expect(secretFingerprint(undefined)).toBeNull();
    expect(secretFingerprint("abc")).toHaveLength(16);
    expect(secretFingerprint("abc")).not.toContain("abc");
  });
});

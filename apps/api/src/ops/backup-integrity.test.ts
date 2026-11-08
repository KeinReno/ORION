import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { vi } from "vitest";
import { verifyNodeBackupIntegrity } from "./backup-integrity";
import { restoreNodeBackup } from "./node-backup";

const directories: string[] = [];
const hash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

async function fixture(options: { driver?: string; path?: string; paths?: string[]; includeStorage?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "orion-backup-integrity-"));
  directories.push(root);
  const tableBody = '{"id":"row-1","value":"secret-row-value"}\n';
  const rowHash = hash('{"id":"row-1","value":"secret-row-value"}');
  const rowDigest = BigInt(`0x${rowHash}`).toString(16).padStart(64, "0");
  await mkdir(path.join(root, "tables"));
  await writeFile(path.join(root, "tables", "tasks.ndjson"), tableBody);
  const paths = options.paths ?? [options.path ?? "workspace/doc.bin"];
  const files = options.includeStorage === false ? [] : paths.map((filePath) => ({ path: filePath, bytes: 4, sha256: hash(Buffer.from([0, 1, 2, 255])) }));
  if (options.includeStorage !== false && !options.path) {
    for (const filePath of paths) {
      const full = path.join(root, "files", ...filePath.split("/"));
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, Buffer.from([0, 1, 2, 255]));
    }
  }
  const manifest = {
    version: 1,
    createdAt: "2026-11-08T00:00:00.000Z",
    migrations: ["migration-one"],
    tables: { tasks: { rows: 1, fileSha256: hash(tableBody), rowsDigest: rowDigest } },
    storage: { driver: options.driver ?? "local", files },
    secrets: { SYNC_SECRET: "0123456789abcdef" }
  };
  await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
  return root;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("offline node backup integrity", () => {
  it("refuses unsafe manifests before invoking the database during restore", async () => {
    const root = await fixture({ path: "../outside" });
    const transaction = vi.fn();
    const prisma = { $transaction: transaction } as unknown as PrismaClient;
    await expect(restoreNodeBackup(prisma, { dir: root, storageDir: path.join(root, "target") })).rejects.toThrow(/небезопасные пути/);
    expect(transaction).not.toHaveBeenCalled();
    await expect(lstat(path.join(root, "target"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("checks table rows, checksums, storage bytes and sizes without changing the backup", async () => {
    const root = await fixture();
    const before = await snapshot(root);
    const result = await verifyNodeBackupIntegrity(root);
    expect(result).toMatchObject({ status: "integrity-verified", migrationReady: false, storageCoverage: "local", tablesChecked: 1, tableRowsChecked: 1, filesChecked: 1 });
    expect(result.issues).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("secret-row-value");
    expect(JSON.stringify(result)).not.toContain("0123456789abcdef");
    expect(JSON.stringify(result)).not.toContain("doc.bin");
    expect(await snapshot(root)).toEqual(before);
  });

  it.each([
    "../outside",
    "/outside",
    "C:/outside",
    "workspace/../outside",
    "workspace\\outside",
    "workspace//outside",
    "workspace/CON.txt",
    "workspace/com1.log",
    "workspace/AUX",
    "workspace/trailing.",
    "workspace/trailing ",
    "workspace/question?.txt",
    "workspace/colon:stream"
  ])("rejects non-canonical storage path %s without echoing it", async (storagePath) => {
    const root = await fixture({ path: storagePath });
    const result = await verifyNodeBackupIntegrity(root);
    expect(result.status).toBe("invalid");
    expect(result.issues).toContain("unsafe-path-or-link");
    expect(JSON.stringify(result)).not.toContain(storagePath);
  });

  it.each([
    { paths: ["Workspace/one.bin", "workspace/two.bin"] },
    { paths: ["workspace/file.bin", "workspace/FILE.BIN"] },
    { paths: ["folder/child/item.bin", "folder/CHILD/other.bin"] }
  ])("rejects case-insensitive path segment collisions: $paths", async ({ paths }) => {
    const root = await fixture({ paths });
    const result = await verifyNodeBackupIntegrity(root);
    expect(result.status).toBe("invalid");
    expect(result.issues).toContain("unsafe-path-or-link");
  });

  it("rejects a symlinked file entry", async () => {
    const root = await fixture({ includeStorage: false });
    const outside = path.join(root, "outside.bin");
    await writeFile(outside, "private-content");
    await mkdir(path.join(root, "files", "workspace"), { recursive: true });
    try {
      await symlink(outside, path.join(root, "files", "workspace", "doc.bin"), "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
      throw error;
    }
    const result = await verifyNodeBackupIntegrity(root);
    expect(result.status).toBe("invalid");
    expect(result.issues).toContain("unsafe-path-or-link");
    expect(JSON.stringify(result)).not.toContain("private-content");
  });

  it("detects changed bytes, declared sizes and table row counts", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "files", "workspace", "doc.bin"), Buffer.from("tampered"));
    await writeFile(path.join(root, "tables", "tasks.ndjson"), '{"id":"different"}\n{"id":"extra"}\n');
    const result = await verifyNodeBackupIntegrity(root);
    expect(result.status).toBe("invalid");
    expect(result.issues).toContain("checksum-mismatch");
    expect(result.issues).toContain("size-mismatch");
    expect(result.issues).toContain("table-count-mismatch");
  });

  it("allows a valid local backup with no files directory", async () => {
    const root = await fixture({ includeStorage: false });
    const result = await verifyNodeBackupIntegrity(root);
    expect(result.status).toBe("integrity-verified");
    expect(result.filesChecked).toBe(0);
  });

  it("accepts an external storage backup with no copied file payload", async () => {
    const root = await fixture({ driver: "webdav", includeStorage: false });
    const result = await verifyNodeBackupIntegrity(root);
    expect(result.status).toBe("integrity-verified");
    expect(result.storageCoverage).toBe("external-not-included");
    expect(result.filesChecked).toBe(0);
  });

  it("rejects malformed table data and unexpected files", async () => {
    const root = await fixture({ includeStorage: false });
    await writeFile(path.join(root, "tables", "extra.ndjson"), "{}");
    await writeFile(path.join(root, "tables", "tasks.ndjson"), "not-json\n");
    const result = await verifyNodeBackupIntegrity(root);
    expect(result.issues).toContain("unexpected-entry");
    expect(result.issues).toContain("invalid-table-data");
  });
});

async function snapshot(root: string): Promise<string> {
  const parts: string[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    for (const name of (await readdir(current)).sort()) {
      const full = path.join(current, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      if ((await lstat(full)).isDirectory()) await walk(full, relative);
      else parts.push(`${relative}:${hash(await readFile(full))}`);
    }
  }
  await walk(root, "");
  return parts.join("\n");
}

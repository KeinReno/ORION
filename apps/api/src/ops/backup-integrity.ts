import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { z } from "zod";

const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 1_000_000;
const MAX_NDJSON_LINE_BYTES = 64 * 1024 * 1024;
const HEX_SHA256 = /^[a-f0-9]{64}$/;
const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MOD = 1n << 256n;

const fileEntrySchema = z.object({
  path: z.string().min(1),
  bytes: z.number().int().nonnegative().safe(),
  sha256: z.string().regex(HEX_SHA256)
}).strict();

const tableEntrySchema = z.object({
  rows: z.number().int().nonnegative().safe(),
  fileSha256: z.string().regex(HEX_SHA256),
  rowsDigest: z.string().regex(HEX_SHA256)
}).strict();

const manifestSchema = z.object({
  version: z.literal(1),
  createdAt: z.string().min(1),
  migrations: z.array(z.string().min(1)).max(MAX_ENTRIES),
  tables: z.record(z.string(), tableEntrySchema),
  storage: z.object({ driver: z.string().min(1), files: z.array(fileEntrySchema).max(MAX_ENTRIES) }).strict(),
  secrets: z.object({ SYNC_SECRET: z.string().regex(/^[a-f0-9]{16}$/).nullable() }).strict()
}).strict();

type Manifest = z.infer<typeof manifestSchema>;

export type BackupIntegrityIssue =
  | "invalid-manifest"
  | "unsafe-path-or-link"
  | "missing-or-unreadable-entry"
  | "unexpected-entry"
  | "checksum-mismatch"
  | "size-mismatch"
  | "table-count-mismatch"
  | "invalid-table-data"
  | "entry-limit-exceeded";

export interface BackupIntegrityReport {
  status: "integrity-verified" | "invalid";
  migrationReady: false;
  storageCoverage: "local" | "external-not-included" | "unknown";
  tablesChecked: number;
  tableRowsChecked: number;
  filesChecked: number;
  bytesChecked: number;
  issues: BackupIntegrityIssue[];
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Read-only structural and byte-integrity check for a node-backup directory.
 * The result intentionally contains no paths, row data, secrets, or parser errors.
 */
export async function verifyNodeBackupIntegrity(directory: string): Promise<BackupIntegrityReport> {
  const issues = new Set<BackupIntegrityIssue>();
  let tablesChecked = 0;
  let tableRowsChecked = 0;
  let filesChecked = 0;
  let bytesChecked = 0;
  let storageCoverage: BackupIntegrityReport["storageCoverage"] = "unknown";
  const fail = (issue: BackupIntegrityIssue): void => { issues.add(issue); };

  let root: string;
  try {
    const rootInfo = await lstat(directory);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      fail("unsafe-path-or-link");
      return report();
    }
    root = path.resolve(directory);
  } catch {
    fail("missing-or-unreadable-entry");
    return report();
  }

  try {
    const rootEntries = await readdir(root, { withFileTypes: true });
    const allowed = new Set(["manifest.json", "tables", "files"]);
    if (rootEntries.some((entry) => entry.isSymbolicLink())) fail("unsafe-path-or-link");
    if (rootEntries.some((entry) => !allowed.has(entry.name))) fail("unexpected-entry");
  } catch {
    fail("missing-or-unreadable-entry");
    return report();
  }

  const manifestPath = path.join(root, "manifest.json");
  let manifest: Manifest;
  try {
    const info = await lstat(manifestPath);
    if (!info.isFile() || info.isSymbolicLink()) {
      fail("unsafe-path-or-link");
      return report();
    }
    if (info.size > MAX_MANIFEST_BYTES) {
      fail("entry-limit-exceeded");
      return report();
    }
    const raw = await readFile(manifestPath);
    bytesChecked += raw.length;
    if (raw.length > MAX_MANIFEST_BYTES) {
      fail("entry-limit-exceeded");
      return report();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    } catch {
      fail("invalid-manifest");
      return report();
    }
    const validated = manifestSchema.safeParse(parsed);
    if (!validated.success || Object.keys(validated.data.tables).length > MAX_ENTRIES) {
      fail("invalid-manifest");
      return report();
    }
    manifest = validated.data;
  } catch {
    fail("missing-or-unreadable-entry");
    return report();
  }

  storageCoverage = manifest.storage.driver === "local" ? "local" : "external-not-included";

  if (Object.keys(manifest.tables).some((name) => !TABLE_NAME.test(name))) {
    fail("unsafe-path-or-link");
    return report();
  }
  const safeStoragePaths = manifest.storage.files.map((file) => canonicalRelativePath(file.path));
  if (safeStoragePaths.some((value) => value === null) || !hasUniqueWindowsSegments(safeStoragePaths as string[])) {
    fail("unsafe-path-or-link");
    return report();
  }

  const tablesDirectory = await checkedDirectory(root, "tables", fail);
  if (!tablesDirectory) return report();
  const tableNames = Object.keys(manifest.tables).sort();
  const actualTableFiles = await listRegularTree(tablesDirectory, fail);
  if (actualTableFiles === null) return report();
  const expectedTableFiles = tableNames.map((name) => `${name}.ndjson`).sort();
  if (!sameStrings(actualTableFiles, expectedTableFiles)) fail("unexpected-entry");

  for (const table of tableNames) {
    const entry = manifest.tables[table]!;
    const target = await resolveContainedFile(tablesDirectory, `${table}.ndjson`, fail);
    if (!target) continue;
    const result = await inspectNdjson(target, entry.rows);
    if (result === null) {
      fail("missing-or-unreadable-entry");
      continue;
    }
    tablesChecked += 1;
    bytesChecked += result.bytes;
    tableRowsChecked += result.rows;
    if (result.sha256 !== entry.fileSha256) fail("checksum-mismatch");
    if (result.rows !== entry.rows) fail("table-count-mismatch");
    if (result.rowsDigest !== entry.rowsDigest) fail("checksum-mismatch");
    if (!result.validJsonLines) fail("invalid-table-data");
  }

  if (manifest.storage.driver === "local") {
    const expectedFiles = safeStoragePaths as string[];
    const filesDirectory = await checkedOptionalDirectory(root, "files", fail, expectedFiles.length === 0);
    if (!filesDirectory) return report();
    let actualFiles: string[] | null;
    try {
      await lstat(filesDirectory);
      actualFiles = await listRegularTree(filesDirectory, fail);
    } catch (error) {
      if (expectedFiles.length === 0 && (error as NodeJS.ErrnoException).code === "ENOENT") actualFiles = [];
      else {
        fail("missing-or-unreadable-entry");
        return report();
      }
    }
    if (actualFiles === null) return report();
    if (!sameStrings(actualFiles, expectedFiles)) fail("unexpected-entry");
    for (let index = 0; index < manifest.storage.files.length; index += 1) {
      const entry = manifest.storage.files[index]!;
      const relative = expectedFiles[index]!;
      const target = await resolveContainedFile(filesDirectory, relative, fail);
      if (!target) continue;
      const result = await inspectFile(target);
      if (!result) {
        fail("missing-or-unreadable-entry");
        continue;
      }
      filesChecked += 1;
      bytesChecked += result.bytes;
      if (result.bytes !== entry.bytes) fail("size-mismatch");
      if (result.sha256 !== entry.sha256) fail("checksum-mismatch");
    }
  } else if (manifest.storage.files.length > 0) {
    // The writer emits no local files for external drivers; accepting them would be ambiguous.
    fail("invalid-manifest");
  } else {
    try {
      await lstat(path.join(root, "files"));
      fail("unexpected-entry");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") fail("missing-or-unreadable-entry");
    }
  }

  return report();

  function report(): BackupIntegrityReport {
    const finalIssues = [...issues];
    return {
      status: finalIssues.length === 0 ? "integrity-verified" : "invalid",
      migrationReady: false,
      storageCoverage,
      tablesChecked,
      tableRowsChecked,
      filesChecked,
      bytesChecked,
      issues: finalIssues
    };
  }
}

function canonicalRelativePath(value: string): string | null {
  if (!value || value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return null;
  const segments = value.split("/");
  if (segments.some((segment) => !isWindowsSafeSegment(segment))) return null;
  if (path.posix.normalize(value) !== value) return null;
  return segments.join("/");
}

function isWindowsSafeSegment(segment: string): boolean {
  if (!segment || segment === "." || segment === "..") return false;
  if (/[<>:"|?*]/.test(segment) || segment.split("").some((character) => character.charCodeAt(0) < 32) || /[ .]$/.test(segment)) return false;
  const deviceBase = segment.split(".", 1)[0]!.replace(/[ .]+$/g, "").toUpperCase();
  if (/^(CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/.test(deviceBase)) return false;
  return true;
}

/** Reject path aliases that collapse to the same Windows path, including parent segments. */
function hasUniqueWindowsSegments(paths: string[]): boolean {
  const seenSegments = new Map<string, string>();
  const seenPaths = new Set<string>();
  for (const value of paths) {
    const segments = value.split("/");
    const foldedPath = segments.map((segment) => segment.toLocaleLowerCase("en-US")).join("/");
    if (seenPaths.has(foldedPath)) return false;
    seenPaths.add(foldedPath);
    let parent = "";
    for (const segment of segments) {
      const key = `${parent}/${segment.toLocaleLowerCase("en-US")}`;
      const prior = seenSegments.get(key);
      if (prior !== undefined && prior !== segment) return false;
      seenSegments.set(key, segment);
      parent = key;
    }
  }
  return true;
}

async function checkedDirectory(root: string, name: string, fail: (issue: BackupIntegrityIssue) => void): Promise<string | null> {
  const target = path.join(root, name);
  try {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      fail("unsafe-path-or-link");
      return null;
    }
    return target;
  } catch {
    fail("missing-or-unreadable-entry");
    return null;
  }
}

async function checkedOptionalDirectory(root: string, name: string, fail: (issue: BackupIntegrityIssue) => void, allowMissing: boolean): Promise<string | null> {
  const target = path.join(root, name);
  try {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      fail("unsafe-path-or-link");
      return null;
    }
    return target;
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return target;
    fail("missing-or-unreadable-entry");
    return null;
  }
}

async function resolveContainedFile(root: string, relative: string, fail: (issue: BackupIntegrityIssue) => void): Promise<string | null> {
  const canonical = canonicalRelativePath(relative);
  if (canonical === null) {
    fail("unsafe-path-or-link");
    return null;
  }
  const target = path.resolve(root, ...canonical.split("/"));
  const rel = path.relative(root, target);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    fail("unsafe-path-or-link");
    return null;
  }
  let cursor = root;
  const segments = canonical.split("/");
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) {
        fail("unsafe-path-or-link");
        return null;
      }
      const last = index === segments.length - 1;
      if (last ? !info.isFile() : !info.isDirectory()) {
        fail("unsafe-path-or-link");
        return null;
      }
    } catch {
      fail("missing-or-unreadable-entry");
      return null;
    }
  }
  return target;
}

async function listRegularTree(root: string, fail: (issue: BackupIntegrityIssue) => void): Promise<string[] | null> {
  const found: string[] = [];
  async function walk(directory: string, prefix: string): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      fail("missing-or-unreadable-entry");
      return false;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        fail("unsafe-path-or-link");
        return false;
      }
      if (entry.isDirectory()) {
        if (!(await walk(path.join(directory, entry.name), relative))) return false;
      } else if (entry.isFile()) {
        found.push(relative);
        if (found.length > MAX_ENTRIES) {
          fail("entry-limit-exceeded");
          return false;
        }
      } else {
        fail("unsafe-path-or-link");
        return false;
      }
    }
    return true;
  }
  return await walk(root, "") ? found.sort() : null;
}

function sameStrings(left: string[], right: string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

async function inspectFile(file: string): Promise<{ bytes: number; sha256: string } | null> {
  try {
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(file)) {
      const buffer = chunk as Buffer;
      bytes += buffer.length;
      hash.update(buffer);
    }
    return { bytes, sha256: hash.digest("hex") };
  } catch {
    return null;
  }
}

async function inspectNdjson(file: string, expectedRows: number): Promise<{
  bytes: number;
  rows: number;
  sha256: string;
  rowsDigest: string;
  validJsonLines: boolean;
} | null> {
  try {
    const fileHash = createHash("sha256");
    let sum = 0n;
    let rows = 0;
    let bytes = 0;
    let validJsonLines = true;
    let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let lastByte = -1;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const stream = createReadStream(file);
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      bytes += buffer.length;
      lastByte = buffer.length ? buffer[buffer.length - 1]! : lastByte;
      fileHash.update(buffer);
      pending = pending.length ? Buffer.concat([pending, buffer]) : buffer;
      let start = 0;
      for (let index = 0; index < pending.length; index += 1) {
        if (pending[index] !== 0x0a) continue;
        const line = pending.subarray(start, index);
        if (line.length > 0 && line[line.length - 1] === 0x0d) {
          validJsonLines = false;
        }
        if (line.length > MAX_NDJSON_LINE_BYTES) validJsonLines = false;
        try {
          const value = JSON.parse(decoder.decode(line));
          if (!value || typeof value !== "object" || Array.isArray(value)) validJsonLines = false;
        } catch {
          validJsonLines = false;
        }
        try {
          const text = decoder.decode(line);
          sum = (sum + BigInt(`0x${sha256(text)}`)) % MOD;
        } catch {
          validJsonLines = false;
        }
        rows += 1;
        start = index + 1;
      }
      pending = pending.subarray(start);
      if (pending.length > MAX_NDJSON_LINE_BYTES) throw new Error("line limit");
    }
    if (pending.length !== 0 || (bytes > 0 && lastByte !== 0x0a)) validJsonLines = false;
    if (bytes === 0 && expectedRows !== 0) validJsonLines = false;
    return {
      bytes,
      rows,
      sha256: fileHash.digest("hex"),
      rowsDigest: sum.toString(16).padStart(64, "0"),
      validJsonLines
    };
  } catch {
    return null;
  }
}

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { verifyNodeBackupIntegrity } from "./backup-integrity";

/**
 * Whole-node backup and restore: every table of the database plus the document
 * files, in one directory with a manifest of checksums.
 *
 * Why this exists next to `pg_dump`: the `.orion` workspace archive (sync/) is
 * identity-excluded by design, so it cannot rebuild a server — accounts, sessions
 * and grants are not in it. A server restore needs rows of *all* tables, and the
 * operator machine does not always have `pg_dump`. This is a plain, inspectable
 * alternative whose restore is rehearsed by an integration test.
 *
 * Requires the migration role (DATABASE_URL): it reads across RLS and the restore
 * switches `session_replication_role` to `replica`, which only a superuser may do.
 * The backup directory holds password hashes and every user's data: protect it
 * like the database itself.
 */

export const NODE_BACKUP_VERSION = 1;
const FETCH_SIZE = 1000;
const INSERT_BATCH = 500;
const MIGRATIONS_TABLE = "_prisma_migrations";
const TX_TIMEOUT_MS = 6 * 60 * 60 * 1000;

export interface TableEntry {
  rows: number;
  /** sha256 of the NDJSON file as written — detects a damaged or edited backup. */
  fileSha256: string;
  /** Order-independent digest of the rows — comparable between source and restored database. */
  rowsDigest: string;
}

export interface FileEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface NodeBackupManifest {
  version: number;
  createdAt: string;
  migrations: string[];
  tables: Record<string, TableEntry>;
  storage: { driver: string; files: FileEntry[] };
  /** Truncated fingerprints, never the secrets: lets a restore notice a wrong SYNC_SECRET. */
  secrets: { SYNC_SECRET: string | null };
}

export interface NodeBackupOptions {
  outDir: string;
  storageDir: string;
  storageDriver?: string;
  syncSecret?: string;
}

export interface RestoreOptions {
  dir: string;
  storageDir: string;
  syncSecret?: string;
}

export interface RestoreReport {
  tables: number;
  rows: number;
  files: number;
  warnings: string[];
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function secretFingerprint(secret: string | undefined): string | null {
  const value = secret?.trim();
  return value ? sha256(`orion-secret-fingerprint:${value}`).slice(0, 16) : null;
}

const MOD = 1n << 256n;

/** Row order differs between a source and a restored table, so combine row hashes with addition. */
class RowsDigest {
  private sum = 0n;
  add(line: string): void {
    this.sum = (this.sum + BigInt(`0x${sha256(line)}`)) % MOD;
  }
  hex(): string {
    return this.sum.toString(16).padStart(64, "0");
  }
}

async function fileSha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  await walk(root);
  return out.sort();
}

async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

async function tableNames(prisma: Pick<PrismaClient, "$queryRawUnsafe">): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '${MIGRATIONS_TABLE}' ORDER BY tablename`
  );
  return rows.map((row) => row.tablename);
}

async function tableColumns(prisma: Pick<PrismaClient, "$queryRawUnsafe">, table: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
    table
  );
  return rows.map((row) => row.column_name);
}

/**
 * json_populate_recordset ignores unknown keys and treats missing columns as
 * NULL. Reject those lossy conversions before computing a schema-normalized
 * digest so restore still requires every archived row to match the table shape.
 */
export function assertBackupRowsMatchColumns(lines: readonly string[], table: string, columns: readonly string[]): void {
  const expected = new Set(columns);
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`Таблица ${table} содержит некорректную строку резервной копии.`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || hasDuplicateJsonKeys(line)) {
      throw new Error(`Таблица ${table} содержит неподдерживаемую строку резервной копии.`);
    }
    const actual = Object.keys(value);
    if (actual.length !== expected.size || actual.some((column) => !expected.has(column))) {
      throw new Error(`Столбцы строки резервной копии ${table} не совпадают со схемой.`);
    }
  }
}

function hasDuplicateJsonKeys(json: string): boolean {
  let offset = 0;
  const whitespace = (): void => {
    while (/\s/.test(json[offset] ?? "")) offset += 1;
  };
  const string = (): string => {
    const start = offset;
    offset += 1;
    while (offset < json.length) {
      const character = json[offset]!;
      offset += 1;
      if (character === "\\") offset += 1;
      else if (character === '"') break;
    }
    return JSON.parse(json.slice(start, offset)) as string;
  };
  const value = (): boolean => {
    whitespace();
    const token = json[offset];
    if (token === '"') {
      string();
      return false;
    }
    if (token === "[") {
      offset += 1;
      whitespace();
      if (json[offset] === "]") { offset += 1; return false; }
      for (;;) {
        if (value()) return true;
        whitespace();
        if (json[offset] === "]") { offset += 1; return false; }
        offset += 1;
      }
    }
    if (token === "{") {
      offset += 1;
      whitespace();
      const keys = new Set<string>();
      if (json[offset] === "}") { offset += 1; return false; }
      for (;;) {
        whitespace();
        const key = string();
        if (keys.has(key)) return true;
        keys.add(key);
        whitespace();
        offset += 1; // colon
        if (value()) return true;
        whitespace();
        if (json[offset] === "}") { offset += 1; return false; }
        offset += 1; // comma
      }
    }
    while (offset < json.length && !/[\s,\]}]/.test(json[offset]!)) offset += 1;
    return false;
  };
  return value();
}

async function appliedMigrations(prisma: Pick<PrismaClient, "$queryRawUnsafe">): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM ${MIGRATIONS_TABLE} WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`
  );
  return rows.map((row) => row.migration_name);
}

type Tx = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">;

/** Streams a table as JSON text lines through a server-side cursor, so memory stays flat. */
async function* tableLines(tx: Tx, table: string): AsyncGenerator<string> {
  await tx.$executeRawUnsafe(`DECLARE orion_cursor NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS j FROM ${quoteIdent(table)} t`);
  try {
    for (;;) {
      const rows = await tx.$queryRawUnsafe<{ j: string }[]>(`FETCH ${FETCH_SIZE} FROM orion_cursor`);
      if (rows.length === 0) return;
      for (const row of rows) yield row.j;
    }
  } finally {
    await tx.$executeRawUnsafe("CLOSE orion_cursor");
  }
}

interface ForeignKeyRow {
  conname: string;
  child: string;
  parent: string;
  child_cols: string[];
  parent_cols: string[];
}

/** Rows whose foreign key points at nothing. MATCH SIMPLE: a NULL in any key column means "no reference". */
export async function findOrphans(tx: Pick<PrismaClient, "$queryRawUnsafe">): Promise<string[]> {
  const keys = await tx.$queryRawUnsafe<ForeignKeyRow[]>(`
    SELECT con.conname, cl.relname AS child, pl.relname AS parent,
      ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum ORDER BY k.ord) AS child_cols,
      ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum ORDER BY k.ord) AS parent_cols
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_class pl ON pl.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE con.contype = 'f' AND n.nspname = 'public'
    ORDER BY con.conname`);
  const problems: string[] = [];
  for (const key of keys) {
    const notNull = key.child_cols.map((col) => `c.${quoteIdent(col)} IS NOT NULL`).join(" AND ");
    const match = key.child_cols.map((col, index) => `p.${quoteIdent(key.parent_cols[index]!)} = c.${quoteIdent(col)}`).join(" AND ");
    const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM ${quoteIdent(key.child)} c WHERE ${notNull} AND NOT EXISTS (SELECT 1 FROM ${quoteIdent(key.parent)} p WHERE ${match})`
    );
    const count = Number(rows[0]?.n ?? 0);
    if (count > 0) problems.push(`${key.child} → ${key.parent} (${key.conname}): ${count}`);
  }
  return problems;
}

export async function createNodeBackup(prisma: PrismaClient, options: NodeBackupOptions): Promise<NodeBackupManifest> {
  const { outDir, storageDir } = options;
  if (!(await isEmptyDir(outDir))) throw new Error(`Каталог резервной копии не пуст: ${outDir}`);
  await mkdir(path.join(outDir, "tables"), { recursive: true });

  const tables: Record<string, TableEntry> = {};
  let migrations: string[] = [];

  // One REPEATABLE READ snapshot for every table, so rows that reference each other are consistent.
  await prisma.$transaction(
    async (tx) => {
      migrations = await appliedMigrations(tx);
      for (const table of await tableNames(tx)) {
        const digest = new RowsDigest();
        const lines: string[] = [];
        let rows = 0;
        for await (const line of tableLines(tx, table)) {
          digest.add(line);
          lines.push(line);
          rows += 1;
        }
        const body = lines.length > 0 ? `${lines.join("\n")}\n` : "";
        const file = path.join(outDir, "tables", `${table}.ndjson`);
        await writeFile(file, body, "utf8");
        tables[table] = { rows, fileSha256: sha256(body), rowsDigest: digest.hex() };
      }
    },
    { isolationLevel: "RepeatableRead", timeout: TX_TIMEOUT_MS, maxWait: 60_000 }
  );

  const driver = options.storageDriver?.trim() || "local";
  const files: FileEntry[] = [];
  if (driver === "local") {
    for (const relative of await listFiles(storageDir)) {
      const source = path.join(storageDir, relative);
      const target = path.join(outDir, "files", relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      files.push({ path: relative, bytes: (await stat(target)).size, sha256: await fileSha256(target) });
    }
  }

  const manifest: NodeBackupManifest = {
    version: NODE_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    migrations,
    tables,
    storage: { driver, files },
    secrets: { SYNC_SECRET: secretFingerprint(options.syncSecret) }
  };
  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function readManifest(dir: string): Promise<NodeBackupManifest> {
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as NodeBackupManifest;
  if (manifest.version !== NODE_BACKUP_VERSION) {
    throw new Error(`Неподдерживаемая версия резервной копии узла: ${String(manifest.version)} (нужна ${NODE_BACKUP_VERSION}).`);
  }
  return manifest;
}

/** Offline integrity check of a backup directory: no database needed. Returns human-readable problems. */
export async function verifyNodeBackup(dir: string): Promise<string[]> {
  const manifest = await readManifest(dir);
  const problems: string[] = [];
  for (const [table, entry] of Object.entries(manifest.tables)) {
    let body: string;
    try {
      body = await readFile(path.join(dir, "tables", `${table}.ndjson`), "utf8");
    } catch {
      problems.push(`нет файла таблицы ${table}`);
      continue;
    }
    if (sha256(body) !== entry.fileSha256) problems.push(`таблица ${table}: контрольная сумма файла не совпала`);
    const count = body === "" ? 0 : body.split("\n").length - 1;
    if (count !== entry.rows) problems.push(`таблица ${table}: ${count} строк вместо ${entry.rows}`);
  }
  for (const file of manifest.storage.files) {
    const full = path.join(dir, "files", file.path);
    try {
      if ((await fileSha256(full)) !== file.sha256) problems.push(`файл ${file.path}: контрольная сумма не совпала`);
    } catch {
      problems.push(`нет файла ${file.path}`);
    }
  }
  return problems;
}

export async function restoreNodeBackup(prisma: PrismaClient, options: RestoreOptions): Promise<RestoreReport> {
  const { dir, storageDir } = options;
  // Validate the manifest and every referenced path before the existing restore
  // reads a table or writes to the target. This is not migration sanitization.
  const integrity = await verifyNodeBackupIntegrity(dir);
  if (integrity.status !== "integrity-verified") {
    throw new Error(`Резервная копия повреждена или содержит небезопасные пути: ${integrity.issues.join(", ")}`);
  }
  const manifest = await readManifest(dir);
  const warnings: string[] = [];

  const damaged = await verifyNodeBackup(dir);
  if (damaged.length > 0) throw new Error(`Резервная копия повреждена:\n- ${damaged.join("\n- ")}`);

  const expectedKey = manifest.secrets.SYNC_SECRET;
  if (expectedKey !== null && secretFingerprint(options.syncSecret) !== expectedKey) {
    warnings.push("SYNC_SECRET отличается от ключа резервной копии (или не задан): сохранённые пароли WebDAV и календарей и зашифрованные снимки не расшифруются.");
  }
  if (manifest.storage.driver !== "local") {
    warnings.push(`Файлы документов хранились во внешнем хранилище (${manifest.storage.driver}) и в копию не входят: перенесите их отдельно.`);
  } else if (!(await isEmptyDir(storageDir))) {
    throw new Error(`Каталог файлов не пуст: ${storageDir}. Восстановление выполняется только на пустой узел.`);
  }

  let rows = 0;
  await prisma.$transaction(
    async (tx) => {
      const migrations = await appliedMigrations(tx);
      if (JSON.stringify(migrations) !== JSON.stringify(manifest.migrations)) {
        throw new Error(
          `Схема целевой БД не совпадает с копией (миграций: ${migrations.length} вместо ${manifest.migrations.length}). Примените те же миграции на пустую БД и повторите.`
        );
      }
      const targetTables = await tableNames(tx);
      const missing = Object.keys(manifest.tables).filter((table) => !targetTables.includes(table));
      if (missing.length > 0) throw new Error(`В целевой БД нет таблиц: ${missing.join(", ")}`);
      for (const table of targetTables) {
        const existing = await tx.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM ${quoteIdent(table)} LIMIT 1`);
        if (existing.length > 0) throw new Error(`Таблица ${table} не пуста: восстановление выполняется только на пустую БД.`);
      }

      // Foreign keys and triggers (e.g. note numbering) must not run while rows are copied verbatim.
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");

      for (const [table, entry] of Object.entries(manifest.tables)) {
        const body = await readFile(path.join(dir, "tables", `${table}.ndjson`), "utf8");
        const lines = body === "" ? [] : body.split("\n").slice(0, -1);
        const columns = await tableColumns(tx, table);
        assertBackupRowsMatchColumns(lines, table, columns);
        const normalizedDigest = new RowsDigest();
        let normalizedCount = 0;
        for (let start = 0; start < lines.length; start += INSERT_BATCH) {
          const payload = `[${lines.slice(start, start + INSERT_BATCH).join(",")}]`;
          const normalized = await tx.$queryRawUnsafe<{ j: string }[]>(
            `SELECT row_to_json(r)::text AS j FROM json_populate_recordset(NULL::${quoteIdent(table)}, $1::json) AS r`,
            payload
          );
          for (const row of normalized) {
            normalizedDigest.add(row.j);
            normalizedCount += 1;
          }
          await tx.$executeRawUnsafe(
            `INSERT INTO ${quoteIdent(table)} SELECT * FROM json_populate_recordset(NULL::${quoteIdent(table)}, $1::json)`,
            payload
          );
        }
        rows += lines.length;

        const digest = new RowsDigest();
        let count = 0;
        for await (const line of tableLines(tx, table)) {
          digest.add(line);
          count += 1;
        }
        if (normalizedCount !== lines.length || count !== entry.rows || digest.hex() !== normalizedDigest.hex()) {
          throw new Error(`Таблица ${table} после восстановления не совпала с копией (${count} из ${entry.rows} строк).`);
        }
      }

      // Replica mode skipped the foreign-key checks above, so prove the result has no orphans.
      const orphans = await findOrphans(tx);
      if (orphans.length > 0) throw new Error(`После восстановления есть висячие ссылки:\n- ${orphans.join("\n- ")}`);
    },
    { timeout: TX_TIMEOUT_MS, maxWait: 60_000 }
  );

  let fileCount = 0;
  if (manifest.storage.driver === "local") {
    for (const file of manifest.storage.files) {
      const target = path.join(storageDir, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(dir, "files", file.path), target);
      if ((await fileSha256(target)) !== file.sha256) throw new Error(`Файл ${file.path} после копирования не совпал с контрольной суммой.`);
      fileCount += 1;
    }
  }

  return { tables: Object.keys(manifest.tables).length, rows, files: fileCount, warnings };
}

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNodeBackup, restoreNodeBackup } from "../src/ops/node-backup";
import { stageSanitizedMigration } from "../src/ops/migration-stage";

const rootMarker = randomBytes(24).toString("hex");
const password = randomBytes(18).toString("hex");
const root = mkdtempSync(path.join(tmpdir(), "orion-r-restore-"));
const rootMarkerPath = path.join(root, ".orion-r-restore-test-root");
writeFileSync(rootMarkerPath, `${rootMarker}\n`, { flag: "wx" });
const cluster = path.join(root, "postgres");
const pgBin = path.resolve(__dirname, "../../../apps/desktop/src-tauri/resources/runtime/postgres/bin");
const sourceBackup = path.join(root, "source-backup");
const stagedBackup = path.join(root, "staged-backup");
const storage = path.join(root, "storage");
const restoredStorage = path.join(root, "restored-storage");
const stepLog = path.join(root, "steps.log");
let port = 0;
let adminUrl = "";
let sourceUrl = "";
let targetUrl = "";
let clusterStartAttempted = false;
let clusterVerified = false;

function step(message: string): void {
  appendFileSync(stepLog, `${new Date().toISOString()} ${message}\n`);
}

let admin: PrismaClient | undefined;
let source: PrismaClient;
let target: PrismaClient;
let sourceToken = "";

function pg(tool: string, args: string[]): void {
  step(`${tool} ${args[0] ?? ""}`);
  // pg_ctl start leaves postgres holding inherited pipes, so a piped stdio would wait forever.
  execFileSync(path.join(pgBin, `${tool}.exe`), args, { stdio: "ignore", windowsHide: true });
}

function pgStatus(): "running" | "stopped" {
  const binary = path.join(pgBin, "pg_ctl.exe");
  if (!existsSync(binary)) throw new Error(`pg_ctl отсутствует: ${binary}`);
  try {
    execFileSync(binary, ["status", "-D", cluster], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    return "running";
  } catch (error) {
    const exitCode = (error as { status?: number }).status;
    if (exitCode === 3) return "stopped";
    throw error;
  }
}

function migrate(url: string): void {
  step("migrate");
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
    maxBuffer: 20 * 1024 * 1024
  });
  step("migrate done");
}

async function portIsFree(value: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(value, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Не удалось определить выделенный тестовый порт")));
        return;
      }
      const selected = address.port;
      server.close((error) => error ? reject(error) : resolve(selected));
    });
  });
}

function assertOwnedTestRoot(): void {
  const canonicalTemp = realpathSync(tmpdir());
  const canonicalRoot = realpathSync(root);
  const prefix = `${canonicalTemp}${path.sep}`;
  const rootInfo = lstatSync(root);
  if (rootInfo.isSymbolicLink() || !canonicalRoot.toLowerCase().startsWith(prefix.toLowerCase()) || !path.basename(canonicalRoot).toLowerCase().startsWith("orion-r-restore-")) {
    throw new Error("Отказ очистки: временный каталог не подтверждён как каталог этого теста");
  }
  const marker = lstatSync(rootMarkerPath);
  if (!marker.isFile() || marker.isSymbolicLink() || readFileSync(rootMarkerPath, "utf8") !== `${rootMarker}\n`) {
    throw new Error("Отказ очистки: маркер временного каталога не совпадает");
  }
}

beforeAll(async () => {
  port = await findFreePort();
  adminUrl = `postgresql://orion:${password}@127.0.0.1:${port}/postgres?connect_timeout=15&pool_timeout=15`;
  sourceUrl = `postgresql://orion:${password}@127.0.0.1:${port}/orion_source?connect_timeout=15&pool_timeout=15`;
  targetUrl = `postgresql://orion:${password}@127.0.0.1:${port}/orion_target?connect_timeout=15&pool_timeout=15`;
  expect(await portIsFree(port)).toBe(true);
  const passwordFile = path.join(root, "pw.txt");
  writeFileSync(passwordFile, `${password}\n`);
  try {
    pg("initdb", [`--pgdata=${cluster}`, "--auth=scram-sha-256", "--username=orion", `--pwfile=${passwordFile}`, "--encoding=UTF8", "--locale=C"]);
  } finally {
    rmSync(passwordFile, { force: true });
  }
  step("create databases");
  execFileSync(path.join(pgBin, "postgres.exe"), ["--single", "-D", cluster, "postgres"], {
    input: "CREATE DATABASE orion_source;\nCREATE DATABASE orion_target;\n",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  clusterStartAttempted = true;
  pg("pg_ctl", ["start", "-w", "-D", cluster, "-l", path.join(root, "postgres.log"), "-o", `-p ${port} -h 127.0.0.1`]);
  delete process.env.DATABASE_URL;
  delete process.env.APP_DATABASE_URL;
  step("connect");
  admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  await admin.$connect();
  const identity = await admin.$queryRawUnsafe<{ data_directory: string; port: number }[]>(
    "SELECT current_setting('data_directory') AS data_directory, current_setting('port')::int AS port"
  );
  if (identity.length !== 1 || realpathSync(identity[0]!.data_directory).toLowerCase() !== realpathSync(cluster).toLowerCase() || identity[0]!.port !== port) {
    await admin.$disconnect();
    throw new Error("Отказ: слушатель тестового порта не подтвердил путь и порт собственного кластера");
  }
  clusterVerified = true;
  const roleRows = await admin.$queryRawUnsafe<{ rolname: string }[]>("SELECT rolname FROM pg_roles WHERE rolname IN ('orion_app', 'orion_system')");
  const existingRoles = new Set(roleRows.map(({ rolname }) => rolname));
  if (!existingRoles.has("orion_system")) {
    await admin.$executeRawUnsafe("CREATE ROLE orion_system NOLOGIN NOSUPERUSER BYPASSRLS");
  }
  if (!existingRoles.has("orion_app")) {
    const escapedPassword = password.replaceAll("'", "''");
    await admin.$executeRawUnsafe(`CREATE ROLE orion_app LOGIN PASSWORD '${escapedPassword}' NOSUPERUSER NOBYPASSRLS`);
  }
  await admin.$executeRawUnsafe("GRANT orion_system TO orion_app");
  await admin.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO orion_app, orion_system");
  await admin.$executeRawUnsafe("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orion_app, orion_system");
  await admin.$executeRawUnsafe("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO orion_app, orion_system");
  migrate(sourceUrl);
  migrate(targetUrl);
  source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  target = new PrismaClient({ datasources: { db: { url: targetUrl } } });
  const user = await source.user.create({ data: { name: "Перенос", passwordHash: "not-a-live-password" } });
  await source.userPreference.create({ data: { userId: user.id, themeLibrary: { "10": "ten", "2": "two" } } });
  sourceToken = `feed-${randomBytes(8).toString("hex")}`;
  await source.workspace.create({ data: { name: "Исходное", icsToken: sourceToken } });
  await source.refreshToken.create({
    data: { userId: user.id, tokenHash: randomBytes(32).toString("hex"), expiresAt: new Date("2030-01-01T00:00:00.000Z") }
  });
}, 600_000);

afterAll(async () => {
  await Promise.allSettled([source?.$disconnect(), target?.$disconnect(), admin?.$disconnect()].filter(Boolean));
  if (clusterStartAttempted && !clusterVerified) {
    throw new Error(`Кластер не удалось подтвердить как собственный; каталог сохранён для безопасности: ${root}`);
  }
  if (clusterVerified) {
    if (pgStatus() === "running") pg("pg_ctl", ["stop", "-w", "-D", cluster, "-m", "fast"]);
    if (pgStatus() !== "stopped" || !(await portIsFree(port))) {
      throw new Error(`Кластер или порт ${port} всё ещё активен; каталог сохранён: ${root}`);
    }
  }
  assertOwnedTestRoot();
  rmSync(root, { recursive: true, force: false });
}, 120_000);

describe("staged migration restore", () => {
  it("restores the sanitized copy into an empty database and leaves the source unchanged", async () => {
    const liveSession = await source.refreshToken.findFirstOrThrow();
    await createNodeBackup(source, { outDir: sourceBackup, storageDir: storage, storageDriver: "local" });
    const before = readFileSync(path.join(sourceBackup, "tables", "workspaces.ndjson"), "utf8");
    const report = await stageSanitizedMigration(sourceBackup, stagedBackup);
    expect(readFileSync(path.join(sourceBackup, "tables", "workspaces.ndjson"), "utf8")).toBe(before);
    expect(before).toContain(sourceToken);
    expect(report.tablesRewritten).toContain("workspaces");
    expect(report.jwtSecret).toBe("absent-from-backup");

    const restored = await restoreNodeBackup(target, { dir: stagedBackup, storageDir: restoredStorage });
    expect(restored.rows).toBeGreaterThan(0);
    const copied = await target.workspace.findFirstOrThrow({ where: { name: "Исходное" } });
    const session = await target.refreshToken.findFirstOrThrow();
    expect(copied.icsToken).toBeNull();
    expect(session.revokedAt).not.toBeNull();
    expect(session.tokenHash).not.toBe(liveSession.tokenHash);
    expect((await target.userPreference.findFirstOrThrow({ where: { userId: liveSession.userId } })).themeLibrary).toEqual({ "10": "ten", "2": "two" });
    expect((await source.refreshToken.findFirstOrThrow()).tokenHash).toBe(liveSession.tokenHash);
    expect((await source.refreshToken.findFirstOrThrow()).revokedAt).toBeNull();

    const original = await source.workspace.findFirstOrThrow({ where: { name: "Исходное" } });
    expect(original.icsToken).toBe(sourceToken);
    expect((await source.refreshToken.findFirstOrThrow()).revokedAt).toBeNull();
    expect(readFileSync(path.join(sourceBackup, "tables", "workspaces.ndjson"), "utf8")).toBe(before);
  }, 600_000);
});

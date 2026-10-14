#!/usr/bin/env node
/**
 * Local PostgreSQL without Docker.
 *
 * Same contract as infra/postgres/docker-compose.yml: 127.0.0.1:5433,
 * superuser `orion` / `orion_local_dev`, database `orion`, then
 * infra/postgres/init/01-app-roles.sql. Data lives in infra/postgres/data
 * (gitignored), not a Docker volume.
 *
 * We drive the zonky binaries shipped by `embedded-postgres` through
 * `pg_ctl start/stop` so the cluster survives after this Node process
 * exits — unlike the library's own `.start()`, which kills Postgres on
 * script shutdown. Docker compose remains `pnpm db:up:docker` for machines
 * that already have the engine.
 *
 * Usage: node scripts/postgres.mjs [up|down|status]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(process.env.ORION_PG_DATA || join(ROOT, "infra", "postgres", "data"));
const ROLES_SQL = join(ROOT, "infra", "postgres", "init", "01-app-roles.sql");
const PORT = Number(process.env.ORION_PG_PORT || 5433);
const USER = "orion";
const PASSWORD = "orion_local_dev";
const DATABASE = "orion";
const ICU_LOCALE = "ru-RU";
/** `CREATE DATABASE` options: ICU default collation, independent of how the cluster was initialised. */
const ICU_DATABASE_OPTIONS = `TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE '${ICU_LOCALE}' LOCALE 'C'`;

const command = process.argv[2] ?? "up";

function log(message) {
  console.log(`[orion-postgres] ${message}`);
}

function fail(message) {
  console.error(`[orion-postgres] ${message}`);
  process.exit(1);
}

async function binaries() {
  const require = createRequire(import.meta.url);
  let embeddedRoot;
  try {
    const entry = require.resolve("embedded-postgres");
    embeddedRoot = dirname(dirname(entry));
  } catch {
    fail("пакет embedded-postgres не установлен — выполните pnpm install");
  }
  const { default: getBinaries } = await import(pathToFileURL(join(embeddedRoot, "dist", "binary.js")).href);
  try {
    return await getBinaries();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function binPath(bin, name) {
  return bin[name] ?? bin.default?.[name];
}

function run(file, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, LC_MESSAGES: "C", ...options.env }
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr, code });
      else reject(new Error(`${file} ${args.join(" ")} exited ${code}\n${stderr || stdout}`));
    });
  });
}

async function waitUntilReady(timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await canConnect()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`Postgres не принял соединения на 127.0.0.1:${PORT} за ${timeoutMs / 1000} с`);
}

async function ctlStatus(pgCtl) {
  try {
    await run(pgCtl, ["status", "-D", DATA_DIR]);
    return true;
  } catch {
    return false;
  }
}

async function initialise(initdb) {
  mkdirSync(DATA_DIR, { recursive: true });
  const pwFile = join(tmpdir(), `orion-pg-pw-${process.pid}`);
  writeFileSync(pwFile, `${PASSWORD}\n`);
  try {
    log("инициализация кластера (один раз)");
    await run(initdb, [
      `--pgdata=${DATA_DIR}`,
      "--auth=password",
      `--username=${USER}`,
      `--pwfile=${pwFile}`,
      "--encoding=UTF8",
      // ICU for the default collation: with a plain libc "C" locale Postgres
      // cannot case-fold Cyrillic, so `ILIKE` / Prisma `mode: "insensitive"`
      // (global search, list filters) would not find «Сидорова» by «сидоров».
      // lc_* stay "C" so server messages and libc behaviour are unchanged.
      "--locale-provider=icu",
      `--icu-locale=${ICU_LOCALE}`,
      "--locale=C",
      "--lc-messages=C"
    ]);
  } finally {
    rmSync(pwFile, { force: true });
  }
}

function adminClient(database = "postgres") {
  return new pg.Client({
    host: "127.0.0.1",
    port: PORT,
    user: USER,
    password: PASSWORD,
    database
  });
}

async function ensureDatabaseAndRoles() {
  const client = adminClient();
  await client.connect();
  try {
    const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [DATABASE]);
    if (found.rowCount === 0) {
      log(`создаю базу ${DATABASE}`);
      // Explicit ICU even on a cluster initialised before the fix (see initialise()).
      await client.query(`CREATE DATABASE ${DATABASE} ${ICU_DATABASE_OPTIONS}`);
    } else {
      const provider = await client.query("SELECT datlocprovider FROM pg_database WHERE datname = $1", [DATABASE]);
      if (provider.rows[0]?.datlocprovider !== "i") {
        log(
          `ВНИМАНИЕ: база ${DATABASE} создана с локалью C — поиск без учёта регистра не работает для кириллицы. ` +
            "Перенос без потери данных: infra/postgres/README.md, раздел «Локаль и поиск по-русски»."
        );
      }
    }
  } finally {
    await client.end();
  }

  const orion = adminClient(DATABASE);
  await orion.connect();
  try {
    const role = await orion.query("SELECT 1 FROM pg_roles WHERE rolname = 'orion_app'");
    if (role.rowCount === 0) {
      log("применяю роли orion_app / orion_system");
      await orion.query(readFileSync(ROLES_SQL, "utf8"));
    }
  } finally {
    await orion.end();
  }
}

async function canConnect() {
  const client = adminClient();
  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    return true;
  } catch {
    return false;
  }
}

async function up() {
  const bin = await binaries();
  const initdb = binPath(bin, "initdb");
  const pgCtl = binPath(bin, "pg_ctl");
  if (!initdb || !pgCtl) fail("в пакете бинарников нет initdb/pg_ctl");

  if (!existsSync(join(DATA_DIR, "PG_VERSION"))) {
    await initialise(initdb);
  }

  if (await ctlStatus(pgCtl)) {
    log(`уже запущен на 127.0.0.1:${PORT}`);
    await ensureDatabaseAndRoles();
    return;
  }

  if (await canConnect()) {
    log(`на 127.0.0.1:${PORT} уже отвечает Postgres с теми же учётными данными — использую его`);
    await ensureDatabaseAndRoles();
    return;
  }

  log(`запускаю 127.0.0.1:${PORT}`);
  try {
    // Do not inherit stdio: on Windows `pg_ctl -w` waits forever if the
    // postmaster keeps the parent's pipes open.
    await run(
      pgCtl,
      ["start", "-D", DATA_DIR, "-l", join(DATA_DIR, "postgres.log"), "-o", `-p ${PORT} -h 127.0.0.1`],
      { stdio: "ignore" }
    );
  } catch (error) {
    const logPath = join(DATA_DIR, "postgres.log");
    const tail = existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n").slice(-8).join("\n") : "";
    const hint =
      `порт ${PORT} занят? остановите Docker-кластер: pnpm db:down:docker\n` +
      (tail ? `\n${logPath}:\n${tail}` : "");
    fail(`${error instanceof Error ? error.message : String(error)}\n${hint}`);
  }
  await waitUntilReady();
  await ensureDatabaseAndRoles();
  log("готово. дальше: pnpm db:generate && pnpm db:migrate");
}

async function down() {
  const bin = await binaries();
  const pgCtl = binPath(bin, "pg_ctl");
  if (!pgCtl) fail("в пакете бинарников нет pg_ctl");
  if (!existsSync(join(DATA_DIR, "PG_VERSION"))) {
    log("кластер ещё не создавался");
    return;
  }
  if (!(await ctlStatus(pgCtl))) {
    log("уже остановлен");
    return;
  }
  log("останавливаю");
  await run(pgCtl, ["stop", "-w", "-D", DATA_DIR, "-m", "fast"]);
}

async function status() {
  const bin = await binaries();
  const pgCtl = binPath(bin, "pg_ctl");
  if (!pgCtl) fail("в пакете бинарников нет pg_ctl");
  const running = existsSync(join(DATA_DIR, "PG_VERSION")) && (await ctlStatus(pgCtl));
  log(running ? `работает на 127.0.0.1:${PORT}` : "остановлен");
  process.exit(running ? 0 : 1);
}

try {
  if (command === "up") await up();
  else if (command === "down") await down();
  else if (command === "status") await status();
  else fail(`неизвестная команда «${command}». up | down | status`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

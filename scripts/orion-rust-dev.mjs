#!/usr/bin/env node
/**
 * Isolated dev stack for the ORION Rust experiment.
 *
 * Does not use the stock dev defaults (API :4000, Postgres :5433 / data
 * infra/postgres/data) or the installed beta (%LOCALAPPDATA%\ORION,
 * %ProgramData%\ORION, Postgres :55432). Ports and the data-dir name come
 * from orion-rust/edition.json.
 *
 * Usage:
 *   node scripts/orion-rust-dev.mjs            print commands, start nothing
 *   node scripts/orion-rust-dev.mjs status     ports and data dir, start nothing
 *   node scripts/orion-rust-dev.mjs up         Postgres, API, web, optional runtime
 *   node scripts/orion-rust-dev.mjs down       stop only processes this script started
 *
 * App DB password: scripts/postgres.mjs does not generate one. On first boot
 * it applies infra/postgres/init/01-app-roles.sql, which has a fixed
 * `CREATE ROLE orion_app LOGIN PASSWORD '...'`. This script reads that literal
 * so apps/api/.env.rust matches the cluster. The superuser is the constant in
 * scripts/postgres.mjs: user `orion`, password `orion_local_dev`, database `orion`.
 *
 * dotenv (`import "dotenv/config"` in the API) does not override variables
 * already present in the environment, and it loads `.env`, not `.env.rust`.
 * `up` therefore puts the same values in the API process environment.
 *
 * `.gitignore` lists `.env` and `.env.local` only, not `.env*`, so
 * `apps/api/.env.rust` is not ignored. Do not commit it.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_PORT = 3011;
const STOCK_PG_PORT = 5433;
const PG_SUPERUSER = "orion";
const PG_SUPERUSER_PASSWORD = "orion_local_dev";
const PG_DATABASE = "orion";
const PG_APP_ROLE = "orion_app";

const edition = JSON.parse(readFileSync(join(ROOT, "orion-rust", "edition.json"), "utf8"));
const apiPort = Number(edition.apiPort);
const pgPort = Number(edition.pgPort);
const runtimePort = Number(edition.runtimePort);
const forbiddenApiPort = Number(edition.forbiddenApiPort);
const forbiddenPgPort = Number(edition.forbiddenPgPort);

const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
const dataRoot = resolve(localAppData, edition.dataDirName);
const pgData = resolve(dataRoot, "postgres-dev");
const storageDir = resolve(dataRoot, "documents");
const statePath = resolve(dataRoot, "dev-stack.json");
const envFile = join(ROOT, "apps", "api", ".env.rust");
const rolesSqlPath = join(ROOT, "infra", "postgres", "init", "01-app-roles.sql");
const runtimeExe = join(ROOT, "orion-rust", "target", "debug", "orion-runtime.exe");
const defaultPgData = resolve(ROOT, "infra", "postgres", "data");
const productionDirs = [
  resolve(localAppData, "ORION"),
  resolve(process.env.ProgramData || "C:\\ProgramData", "ORION")
];

const command = process.argv[2] ?? "print";
let shuttingDown = false;
/** @type {import("node:child_process").ChildProcess[]} */
const live = [];

function log(message) {
  console.log(`[orion-rust-dev] ${message}`);
}

function fail(message) {
  console.error(`[orion-rust-dev] ${message}`);
  process.exit(1);
}

function sameOrInside(candidate, root) {
  const child = resolve(candidate);
  const base = resolve(root);
  const left = process.platform === "win32" ? child.toLowerCase() : child;
  const right = process.platform === "win32" ? base.toLowerCase() : base;
  return left === right || left.startsWith(right.endsWith(sep) ? right : right + sep);
}

function assertIsolatedPaths() {
  for (const candidate of [dataRoot, pgData, storageDir]) {
    for (const production of productionDirs) {
      if (sameOrInside(candidate, production)) {
        fail(`ORION Rust не использует каталог обычного ORION (${production}).`);
      }
    }
    if (sameOrInside(candidate, defaultPgData) || sameOrInside(defaultPgData, candidate)) {
      fail(`Каталог Postgres эксперимента совпал с infra/postgres/data (${defaultPgData}).`);
    }
  }
}

function assertPorts() {
  const badPg = new Set([STOCK_PG_PORT, forbiddenPgPort]);
  const badApi = new Set([forbiddenApiPort, 4000]);
  if (!Number.isInteger(apiPort) || badApi.has(apiPort)) {
    fail(`API-порт ${apiPort} запрещён. Обычный ORION занимает ${[...badApi].join(", ")}.`);
  }
  if (!Number.isInteger(pgPort) || badPg.has(pgPort)) {
    fail(`Порт Postgres ${pgPort} запрещён. Нельзя использовать ${[...badPg].join(" или ")}.`);
  }
  if (!Number.isInteger(runtimePort) || runtimePort === apiPort || badApi.has(runtimePort) || badPg.has(runtimePort)) {
    fail(`Порт runtime ${runtimePort} пересекается с запрещённым или занятым портом стека.`);
  }
  if (WEB_PORT === apiPort || badApi.has(WEB_PORT) || badPg.has(WEB_PORT)) {
    fail(`Порт веба ${WEB_PORT} пересекается с портом API или Postgres.`);
  }
}

function urlUsesBlockedPort(url) {
  return /@(?:127\.0\.0\.1|localhost):(?:5433|55432)\b/i.test(url);
}

/** Drop inherited stock-stack variables so a parent shell cannot leak them into children. */
function scrubInherited(env) {
  const next = { ...env };
  for (const key of ["ORION_PG_PORT", "ORION_DESKTOP_PG_PORT"]) {
    if (next[key] === String(STOCK_PG_PORT) || next[key] === String(forbiddenPgPort)) delete next[key];
  }
  for (const key of ["PORT", "ORION_DESKTOP_API_PORT"]) {
    if (next[key] === "4000" || next[key] === String(forbiddenApiPort)) delete next[key];
  }
  for (const key of ["DATABASE_URL", "APP_DATABASE_URL"]) {
    if (typeof next[key] === "string" && urlUsesBlockedPort(next[key])) delete next[key];
  }
  return next;
}

function assertSafeEnv(env, label) {
  const pgValues = [env.ORION_PG_PORT, env.ORION_DESKTOP_PG_PORT].filter(Boolean);
  for (const value of pgValues) {
    if (value === String(STOCK_PG_PORT) || value === String(forbiddenPgPort)) {
      fail(`${label}: в окружение попал запрещённый порт Postgres ${value}.`);
    }
  }
  const apiValues = [env.PORT, env.ORION_DESKTOP_API_PORT].filter(Boolean);
  for (const value of apiValues) {
    if (value === "4000" || value === String(forbiddenApiPort)) {
      fail(`${label}: в окружение попал запрещённый порт API ${value}.`);
    }
  }
  for (const url of [env.DATABASE_URL, env.APP_DATABASE_URL].filter(Boolean)) {
    if (urlUsesBlockedPort(url)) fail(`${label}: URL базы содержит запрещённый порт.`);
  }
}

function assertApiUrls(env) {
  for (const key of ["DATABASE_URL", "APP_DATABASE_URL"]) {
    const url = env[key];
    if (!url || !url.includes(`@127.0.0.1:${pgPort}/${PG_DATABASE}`)) {
      fail(`${key} не указывает на 127.0.0.1:${pgPort}/${PG_DATABASE}.`);
    }
  }
}

function appRolePassword() {
  const sql = readFileSync(rolesSqlPath, "utf8");
  const match = sql.match(/CREATE ROLE orion_app LOGIN PASSWORD '([^']+)'/);
  if (!match) {
    fail(
      "В infra/postgres/init/01-app-roles.sql нет фиксированного пароля orion_app. " +
        "postgres.mjs применяет этот файл как есть и сам пароль не задаёт — обновите разбор в orion-rust-dev.mjs."
    );
  }
  return match[1];
}

function databaseUrl(user, password) {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${pgPort}/${PG_DATABASE}`;
}

function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"')) value = JSON.parse(value);
    out[key] = value;
  }
  return out;
}

function envRustIsGitignored() {
  const text = readFileSync(join(ROOT, ".gitignore"), "utf8");
  return text.split(/\r?\n/).some((line) => {
    const rule = line.trim();
    return rule === ".env*" || rule === "apps/api/.env*" || rule === "apps/api/.env.rust" || rule === ".env.rust";
  });
}

function writeEnvFile() {
  const previous = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
  const jwtSecret = previous.JWT_SECRET?.trim() || randomBytes(32).toString("base64url");
  const syncSecret = previous.SYNC_SECRET?.trim() || randomBytes(32).toString("base64");
  const kept = Boolean(previous.JWT_SECRET?.trim() && previous.SYNC_SECRET?.trim());
  const vars = {
    DATABASE_URL: databaseUrl(PG_SUPERUSER, PG_SUPERUSER_PASSWORD),
    APP_DATABASE_URL: databaseUrl(PG_APP_ROLE, appRolePassword()),
    PORT: String(apiPort),
    HOST: "127.0.0.1",
    WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
    ORION_MODE: "local",
    STORAGE_DIR: storageDir,
    // Локальная разработка без внешних сервисов: Architect читает git-репозитории
    // из корня этой копии (GitHub не нужен), каталог ORION DEV — из ./development.
    ORION_DEV_REPOSITORY_ROOTS: ROOT,
    ORION_DEV_CATALOG_ROOT: ROOT,
    JWT_SECRET: jwtSecret,
    SYNC_SECRET: syncSecret,
    ...(previous.ORION_GITHUB_UPDATE_TOKEN?.trim()
      ? { ORION_GITHUB_UPDATE_TOKEN: previous.ORION_GITHUB_UPDATE_TOKEN.trim() }
      : {})
  };
  const body = [
    "# ORION Rust dev stack — scripts/orion-rust-dev.mjs",
    "# Пароль orion_app взят из infra/postgres/init/01-app-roles.sql (фиксированный LOGIN PASSWORD).",
    "# Суперпользователь — константы scripts/postgres.mjs: orion / orion_local_dev, база orion.",
    "# Секреты JWT_SECRET и SYNC_SECRET при повторном запуске не перезаписываются.",
    ...Object.entries(vars).map(([key, value]) => `${key}=${JSON.stringify(value)}`),
    ""
  ].join("\n");
  writeFileSync(envFile, body, "utf8");
  log(
    kept
      ? "JWT_SECRET и SYNC_SECRET оставлены из apps/api/.env.rust."
      : "JWT_SECRET и SYNC_SECRET записаны в apps/api/.env.rust (значения не печатаются)."
  );
  if (!envRustIsGitignored()) {
    log("apps/api/.env.rust не покрыт .gitignore (там только .env и .env.local). Не коммитьте этот файл.");
  }
  return vars;
}

function readState() {
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

function commandLine(pid) {
  if (process.platform !== "win32") return "";
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}").CommandLine`
    ],
    { encoding: "utf8", windowsHide: true }
  );
  return `${result.stdout || ""}`.trim();
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 4) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isOurProcess(pid) {
  if (!processAlive(pid) || pid === process.pid) return false;
  if (process.platform !== "win32") return true;
  const line = commandLine(pid);
  if (!line) return false;
  return /orion-rust-dev\.mjs|@orion\/api|@orion\/web|orion-runtime|ts-node-dev|scripts[\\/]postgres\.mjs/i.test(line);
}

function trustedKill(pid) {
  if (!Number.isInteger(pid) || pid <= 4 || pid === process.pid) return;
  log(`останавливаю pid ${pid}`);
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
}

function killRecorded(pid) {
  if (!processAlive(pid) || pid === process.pid) return;
  if (!isOurProcess(pid)) {
    log(`пропускаю pid ${pid}: процесс жив, но это не стек orion-rust-dev.`);
    return;
  }
  trustedKill(pid);
}

function pnpmExecutable() {
  if (process.platform !== "win32") return "pnpm";
  const where = spawnSync("where.exe", ["pnpm"], { encoding: "utf8", windowsHide: true });
  const cmd = (where.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().endsWith(".cmd"));
  return cmd || "pnpm.cmd";
}

function spawnNode(args, env) {
  assertSafeEnv(env, "node");
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env,
    stdio: "inherit",
    windowsHide: false,
    detached: false
  });
  live.push(child);
  child.on("exit", () => {
    const index = live.indexOf(child);
    if (index >= 0) live.splice(index, 1);
  });
  return child;
}

function quoteCmd(value) {
  const text = String(value);
  if (text.length === 0) return '""';
  if (!/[\s"&|<>^]/u.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function spawnPnpm(args, env) {
  assertSafeEnv(env, "pnpm");
  // pnpm on Windows is a .cmd shim. Spawn cmd.exe in this console (detached is
  // false) so Ctrl+C reaches the same process group; do not use bash.
  let child;
  if (process.platform === "win32") {
    const inner = [quoteCmd(pnpmExecutable()), ...args.map(quoteCmd)].join(" ");
    child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${inner}"`], {
      cwd: ROOT,
      env,
      stdio: "inherit",
      windowsHide: false,
      detached: false,
      windowsVerbatimArguments: true
    });
  } else {
    child = spawn(pnpmExecutable(), args, {
      cwd: ROOT,
      env,
      stdio: "inherit",
      detached: false
    });
  }
  live.push(child);
  child.on("exit", () => {
    const index = live.indexOf(child);
    if (index >= 0) live.splice(index, 1);
  });
  return child;
}

function waitExit(child) {
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit(signal ? 1 : (code ?? 1)));
  });
}

function pgEnv() {
  const env = {
    ...scrubInherited(process.env),
    ORION_PG_PORT: String(pgPort),
    ORION_PG_DATA: pgData
  };
  assertSafeEnv(env, "postgres");
  return env;
}

function stopPostgres() {
  return waitExit(spawnNode([join(ROOT, "scripts", "postgres.mjs"), "down"], pgEnv()));
}

function killLive() {
  for (const child of [...live]) {
    if (child.pid) trustedKill(child.pid);
  }
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  killLive();
  let pgCode = 0;
  try {
    pgCode = await stopPostgres();
  } catch (error) {
    pgCode = 1;
    console.error(`[orion-rust-dev] ${error instanceof Error ? error.message : String(error)}`);
  }
  rmSync(statePath, { force: true });
  process.exit(exitCode || pgCode);
}

function printPlan(kind) {
  const supervisor = readState()?.supervisorPid;
  let running = false;
  if (supervisor) {
    try {
      process.kill(supervisor, 0);
      running = true;
    } catch {
      running = false;
    }
  }
  log(`данные: ${dataRoot}`);
  log(`postgres: 127.0.0.1:${pgPort}  ${pgData}`);
  log(`api: http://127.0.0.1:${apiPort}`);
  log(`web: http://localhost:${WEB_PORT}  NEXT_PUBLIC_API_URL=http://localhost:${apiPort}`);
  log(`runtime: 127.0.0.1:${runtimePort}`);
  log(`не используются порты API ${forbiddenApiPort} и PostgreSQL ${STOCK_PG_PORT}, ${forbiddenPgPort}`);
  if (kind === "status") {
    log(`стек: ${running ? `запущен (pid ${supervisor})` : "не запущен"}`);
    log(
      existsSync(runtimeExe)
        ? `runtime binary: ${runtimeExe}`
        : "runtime binary: нет, диагностика будет пропущена"
    );
    return;
  }
  const ps = (value) => `'${String(value).replaceAll("'", "''")}'`;
  console.log("");
  console.log("# Команды (секреты не печатаются; API берёт их из окружения и apps/api/.env.rust):");
  console.log(`$env:ORION_PG_PORT = '${pgPort}'`);
  console.log(`$env:ORION_PG_DATA = ${ps(pgData)}`);
  console.log("node scripts/postgres.mjs up");
  console.log(`$env:PORT = '${apiPort}'`);
  console.log(`$env:HOST = '127.0.0.1'`);
  console.log(`$env:WEB_ORIGIN = 'http://localhost:${WEB_PORT}'`);
  console.log("$env:ORION_MODE = 'local'");
  console.log(`$env:STORAGE_DIR = ${ps(storageDir)}`);
  console.log("# DATABASE_URL / APP_DATABASE_URL / JWT_SECRET / SYNC_SECRET — из apps/api/.env.rust, в процесс, не на экран");
  console.log("pnpm --filter @orion/api dev");
  console.log(`$env:NEXT_PUBLIC_API_URL = 'http://localhost:${apiPort}'`);
  console.log(`$env:PORT = '${WEB_PORT}'`);
  console.log(`pnpm --filter @orion/web dev -- --port ${WEB_PORT}`);
  console.log(`$env:ORION_DESKTOP_DATA_DIR = ${ps(dataRoot)}`);
  console.log(`$env:ORION_DESKTOP_API_PORT = '${apiPort}'`);
  console.log(`$env:ORION_DESKTOP_PG_PORT = '${pgPort}'`);
  console.log(`$env:ORION_RUST_RUNTIME_PORT = '${runtimePort}'`);
  console.log(`& ${ps(runtimeExe)} serve`);
  console.log("");
}

function webDevArgs() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "apps", "web", "package.json"), "utf8"));
  const devScript = String(pkg.scripts?.dev ?? "");
  // The package script hardcodes `next dev --port …`. Next 14 parses flags with
  // the `arg` package, which keeps the last `--port`. Extra pnpm args are
  // appended to that script, so this overrides a 3010 default. PORT alone does not.
  if (devScript.includes(`--port ${WEB_PORT}`) || devScript.includes(`--port=${WEB_PORT}`)) {
    return ["--filter", "@orion/web", "dev"];
  }
  if (!devScript.includes("--port")) {
    log("В apps/web dev-скрипте нет --port; дополнительно задаю PORT, его Next читает, если флага нет.");
  }
  return ["--filter", "@orion/web", "dev", "--", "--port", String(WEB_PORT)];
}

function remember(child, state) {
  if (!child.pid) {
    console.error("[orion-rust-dev] процесс не получил pid");
    void shutdown(1);
    return;
  }
  state.children.push(child.pid);
  writeState(state);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`[orion-rust-dev] процесс ${child.pid} завершился (${signal || code}). Останавливаю стек.`);
    void shutdown(code === 0 ? 0 : code || 1);
  });
}

async function up() {
  const existing = readState();
  if (existing?.supervisorPid && isOurProcess(existing.supervisorPid)) {
    fail(`стек уже запущен (pid ${existing.supervisorPid}). Остановите его: node scripts/orion-rust-dev.mjs down`);
  }
  printPlan("up");
  mkdirSync(storageDir, { recursive: true });
  const apiVars = writeEnvFile();
  const apiEnv = {
    ...scrubInherited(process.env),
    ...apiVars,
    PORT: String(apiPort),
    HOST: "127.0.0.1",
    ORION_MODE: "local",
    ORION_EDITION: "rust"
  };
  assertApiUrls(apiEnv);
  const state = { supervisorPid: process.pid, children: [] };
  writeState(state);
  process.on("SIGINT", () => void shutdown(130));
  process.on("SIGTERM", () => void shutdown(143));

  log(`Postgres 127.0.0.1:${pgPort}, данные ${pgData}`);
  const pgCode = await waitExit(spawnNode([join(ROOT, "scripts", "postgres.mjs"), "up"], pgEnv()));
  if (shuttingDown) return;
  if (pgCode !== 0) {
    console.error(`[orion-rust-dev] postgres.mjs up завершился с кодом ${pgCode}`);
    await shutdown(pgCode);
    return;
  }

  log("генерирую клиент Prisma и применяю миграции в базу эксперимента");
  const generateCode = await waitExit(spawnPnpm(["--filter", "@orion/api", "prisma:generate"], apiEnv));
  if (shuttingDown) return;
  if (generateCode !== 0) {
    console.error(`[orion-rust-dev] prisma generate завершился с кодом ${generateCode}`);
    await shutdown(generateCode);
    return;
  }
  const migrateCode = await waitExit(spawnPnpm(["--filter", "@orion/api", "prisma:migrate:deploy"], apiEnv));
  if (shuttingDown) return;
  if (migrateCode !== 0) {
    console.error(`[orion-rust-dev] prisma migrate deploy завершился с кодом ${migrateCode}`);
    await shutdown(migrateCode);
    return;
  }

  const api = spawnPnpm(["--filter", "@orion/api", "dev"], apiEnv);
  api.on("error", (error) => {
    console.error(`[orion-rust-dev] не удалось запустить API: ${error.message}`);
    void shutdown(1);
  });
  remember(api, state);

  const web = spawnPnpm(webDevArgs(), {
    ...scrubInherited(process.env),
    NEXT_PUBLIC_API_URL: `http://localhost:${apiPort}`,
    PORT: String(WEB_PORT)
  });
  web.on("error", (error) => {
    console.error(`[orion-rust-dev] не удалось запустить web: ${error.message}`);
    void shutdown(1);
  });
  remember(web, state);

  if (!existsSync(runtimeExe)) {
    log(`диагностика пропущена: нет ${runtimeExe}`);
  } else {
    const runtimeEnv = {
      ...scrubInherited(process.env),
      ORION_DESKTOP_DATA_DIR: dataRoot,
      ORION_DESKTOP_API_PORT: String(apiPort),
      ORION_DESKTOP_PG_PORT: String(pgPort),
      ORION_RUST_RUNTIME_PORT: String(runtimePort)
    };
    assertSafeEnv(runtimeEnv, "runtime");
    const runtime = spawn(runtimeExe, ["serve"], {
      cwd: ROOT,
      env: runtimeEnv,
      stdio: "inherit",
      windowsHide: false,
      detached: false
    });
    live.push(runtime);
    runtime.on("error", (error) => {
      console.error(`[orion-rust-dev] runtime не запустился: ${error.message}`);
      void shutdown(1);
    });
    remember(runtime, state);
    log(`runtime слушает 127.0.0.1:${runtimePort}`);
  }

  log("стек запущен. Ctrl+C останавливает только эти процессы и Postgres эксперимента.");
  await new Promise(() => {});
}

async function down() {
  const state = readState();
  const pids = [];
  if (state?.supervisorPid) pids.push(state.supervisorPid);
  if (Array.isArray(state?.children)) pids.push(...state.children);
  for (const pid of [...new Set(pids)]) killRecorded(pid);
  let pgCode = 0;
  try {
    pgCode = await stopPostgres();
  } catch (error) {
    pgCode = 1;
    console.error(`[orion-rust-dev] ${error instanceof Error ? error.message : String(error)}`);
  }
  if (pgCode === 0) rmSync(statePath, { force: true });
  process.exit(pgCode === 0 ? 0 : pgCode);
}

assertPorts();
assertIsolatedPaths();

try {
  if (command === "up") await up();
  else if (command === "down") await down();
  else if (command === "status" || command === "print") printPlan(command === "status" ? "status" : "print");
  else fail(`неизвестная команда «${command}». print | up | down | status`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

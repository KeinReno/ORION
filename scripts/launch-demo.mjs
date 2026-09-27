#!/usr/bin/env node
/**
 * Starts the shareable ORION demo: portable Postgres → API → web → browser.
 * Isolated ports so it can run next to a development copy.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptsDir, "..");

const PG_PORT = Number(process.env.ORION_PG_PORT || 5435);
const API_PORT = Number(process.env.ORION_API_PORT || 4010);
const WEB_PORT = Number(process.env.ORION_WEB_PORT || 3020);
const APP_PASSWORD = "OcjNaKnQFUp0gdwdju-cSP9T_0gaiOZI";
const JWT_SECRET = "orion-demo-share-key-not-for-production-use-32b";

process.chdir(root);
process.env.ORION_PG_PORT = String(PG_PORT);
process.env.ORION_PG_DATA = join(root, "infra", "postgres", "data");
process.env.PORT = String(API_PORT);
process.env.DATABASE_URL = `postgresql://orion:orion_local_dev@127.0.0.1:${PG_PORT}/orion`;
process.env.APP_DATABASE_URL = `postgresql://orion_app:${APP_PASSWORD}@127.0.0.1:${PG_PORT}/orion`;
process.env.JWT_SECRET = JWT_SECRET;
process.env.JWT_EXPIRES_IN = "15m";
process.env.REFRESH_TOKEN_TTL_DAYS = "30";
process.env.WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_DIR = join(root, "apps", "api", ".data", "documents");
process.env.NEXT_PUBLIC_API_URL = `http://localhost:${API_PORT}`;

function pnpmCmd() {
  const win = process.platform === "win32";
  const local = join(root, "node_modules", ".bin", win ? "pnpm.cmd" : "pnpm");
  if (existsSync(local)) return `"${local}"`;
  return "corepack pnpm";
}

function tcpOpen(port) {
  return new Promise((resolveOk) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (ok) => {
      socket.destroy();
      resolveOk(ok);
    };
    socket.setTimeout(400);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function run(cmdline, options = {}) {
  const result = spawnSync(cmdline, { cwd: root, stdio: "inherit", shell: true, env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFail) {
    throw new Error(`${cmdline} завершился с кодом ${result.status}`);
  }
  return result.status ?? 1;
}

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

function writeEnv() {
  writeFileSync(
    join(root, "apps", "api", ".env"),
    [
      `DATABASE_URL="${process.env.DATABASE_URL}"`,
      `APP_DATABASE_URL="${process.env.APP_DATABASE_URL}"`,
      `JWT_SECRET="${JWT_SECRET}"`,
      `JWT_EXPIRES_IN="15m"`,
      `REFRESH_TOKEN_TTL_DAYS=30`,
      `PORT=${API_PORT}`,
      `WEB_ORIGIN="http://localhost:${WEB_PORT}"`,
      `STORAGE_DRIVER=local`,
      `STORAGE_DIR=./.data/documents`,
      `MAX_UPLOAD_MB=50`,
      `SYNC_SECRET=`,
      ""
    ].join("\n")
  );
  writeFileSync(join(root, "apps", "web", ".env.local"), `NEXT_PUBLIC_API_URL=http://localhost:${API_PORT}\n`);
}

function startLogged(name, cmdline, cwd = root) {
  const logDir = join(root, "tmp");
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, `orion-${name}.log`);
  const fd = openSync(logFile, "w");
  const child = spawn(cmdline, {
    cwd,
    env: process.env,
    shell: true,
    windowsHide: true,
    stdio: ["ignore", fd, fd]
  });
  console.log(`${name} → ${logFile}`);
  return child;
}

async function waitPort(port, name, seconds, child) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (child?.exitCode != null && child.exitCode !== 0) {
      throw new Error(`${name} завершился с кодом ${child.exitCode}`);
    }
    if (await tcpOpen(port)) {
      console.log(`${name} слушает :${port}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${name} не поднялся на порту ${port} за ${seconds} с`);
}

function openBrowser(url) {
  if (process.platform === "win32") {
    spawnSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
    return;
  }
  spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

async function main() {
  const pnpm = pnpmCmd();
  console.log(`ORION демо: ${root}`);
  console.log(`Браузер: http://localhost:${WEB_PORT}`);
  writeEnv();

  if (!existsSync(join(root, "node_modules"))) {
    console.log("Первый запуск: установка зависимостей (нужен интернет)…");
    run("corepack enable", { allowFail: true });
    run("corepack pnpm install");
  }

  console.log("Postgres…");
  run(`"${process.execPath}" scripts/postgres.mjs up`);
  run(`${pnpm} --filter @orion/api prisma:generate`);
  run(`${pnpm} --filter @orion/api prisma:migrate:deploy`);
  run(`"${process.execPath}" scripts/seed-demo-workspace.mjs --isolated --if-missing`);

  let api = null;
  let web = null;
  try {
    if (!(await tcpOpen(API_PORT))) {
      console.log(`API :${API_PORT}…`);
      api = startLogged("api", `${pnpm} --filter @orion/api dev`);
      await waitPort(API_PORT, "API", 120, api);
    } else {
      console.log(`API уже слушает :${API_PORT}`);
    }
    if (!(await tcpOpen(WEB_PORT))) {
      console.log(`Web :${WEB_PORT}…`);
      run(`"${process.execPath}" apps/web/scripts/copy-pdf-worker.mjs`);
      web = startLogged("web", `${pnpm} exec next dev --port ${WEB_PORT}`, join(root, "apps", "web"));
      await waitPort(WEB_PORT, "Web", 180, web);
    } else {
      console.log(`Web уже слушает :${WEB_PORT}`);
    }
    openBrowser(`http://localhost:${WEB_PORT}`);
    console.log("");
    console.log("Пароль у всех учёток: 1111");
    console.log("  Мария Волкова   volkova@severny-kontur.ru   владелец");
    console.log("  Павел Орлов     orlov@severny-kontur.ru     тимлид");
    console.log("  Анна Белова     belova@severny-kontur.ru    участник");
    console.log("Пространство: Демонстрационный 1");
    console.log("Закройте это окно, чтобы остановить демо.");
    await new Promise((resolveWait) => {
      const stop = () => resolveWait();
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      if (process.stdin.isTTY) {
        console.log("Нажмите Enter, чтобы остановить.");
        process.stdin.resume();
        process.stdin.once("data", stop);
      }
    });
  } finally {
    killTree(web);
    killTree(api);
    run(`"${process.execPath}" scripts/postgres.mjs down`, { allowFail: true });
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

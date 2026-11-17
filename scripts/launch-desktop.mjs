/**
 * Starts ORION from the current checkout (not a frozen tauri.exe).
 * Postgres → API :14000 → web :3011 → Tauri window (devUrl).
 * Порты этой рабочей копии отличаются от установленной беты (:4000/:3010) намеренно —
 * оба экземпляра могут работать одновременно.
 */
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeReadinessFailure, pollReadiness } from "./readiness.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptsDir, "..");
const lockFile = path.join(root, "tmp", "orion-launch.lock");

function tcpOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(400);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function tailLog(file, maxChars = 2500) {
  try {
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return "(пока пусто)";
    return text.length <= maxChars ? text : text.slice(-maxChars);
  } catch {
    return "(нет файла лога)";
  }
}

async function waitPort(port, name, seconds, service) {
  const deadline = Date.now() + seconds * 1000;
  let lastPulse = 0;
  while (Date.now() < deadline) {
    if (service?.child.exitCode != null && service.child.exitCode !== 0) {
      throw new Error(
        `${name} сразу завершился с кодом ${service.child.exitCode}.\n${tailLog(service.logFile)}`,
      );
    }
    if (await tcpOpen(port)) {
      console.log(`${name} слушает :${port}`);
      return;
    }
    const now = Date.now();
    if (now - lastPulse > 5000) {
      lastPulse = now;
      const left = Math.max(0, Math.ceil((deadline - now) / 1000));
      console.log(`Жду ${name} на :${port} (ещё ${left} с)…`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `${name} не поднялся на порту ${port} за ${seconds} с.\n${service ? tailLog(service.logFile) : ""}`,
  );
}

/**
 * HTTP readiness for the API, on top of `pollReadiness` (S18): distinguishes
 * a genuinely-not-ready API (still starting, DB not up yet) from the port
 * being occupied by something that isn't ORION's API at all ("занят порт"),
 * and from the spawned process already crashing ("API умер") — a plain TCP
 * connect (`tcpOpen`) can't tell any of those apart, it only says "something
 * answers here".
 */
async function waitApiReady(port, seconds, service) {
  const deadlineMs = Date.now() + seconds * 1000;
  const result = await pollReadiness({
    url: `http://127.0.0.1:${port}/system/health`,
    fetchImpl: (url) => fetch(url),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    deadlineMs,
    pollIntervalMs: 400,
    isCrashed: () => service?.child.exitCode != null && service.child.exitCode !== 0
  });
  if (result.state === "ready") {
    console.log(`API слушает :${port} и отвечает на /system/health`);
    return;
  }
  throw new Error(
    describeReadinessFailure(result, {
      name: "API",
      port,
      logTail: service ? tailLog(service.logFile) : undefined
    })
  );
}

/**
 * Second launch of the shortcut/`pnpm dev:app` while one is already running:
 * refuse to spawn a second, conflicting set of processes on the same ports.
 * A PID lockfile (not just "is the port open", which a slow-dying previous
 * instance can leave misleadingly true) is enough here — Tauri itself has no
 * cross-instance IPC available for a "just focus the existing window"
 * upgrade without a native single-instance plugin, which is out of scope
 * for this thin, no-business-logic wrapper (see CLAUDE.md).
 */
function checkSingleInstance() {
  if (!fs.existsSync(lockFile)) return;
  const pid = Number((fs.readFileSync(lockFile, "utf8") || "").trim());
  if (!pid || !processAlive(pid)) {
    fs.rmSync(lockFile, { force: true });
    return;
  }
  throw new Error(
    `ORION уже запущен (процесс launch-desktop, pid ${pid}). Закрой существующее окно/процесс, прежде чем открывать новый — иначе второй экземпляр столкнётся с занятыми портами :14000/:3011.`
  );
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeLock() {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, String(process.pid));
}

function releaseLock() {
  try {
    fs.rmSync(lockFile, { force: true });
  } catch {
    /* best effort */
  }
}

function run(cmdline) {
  const result = spawnSync(cmdline, {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmdline} завершился с кодом ${result.status}`);
  }
}

function runQuiet(cmdline) {
  return spawnSync(cmdline, {
    cwd: root,
    stdio: "ignore",
    shell: true,
  });
}

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  child.kill("SIGTERM");
}

function startService(name, pnpmScript, env = {}) {
  const logFile = path.join(root, "tmp", `orion-${name}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, "w");
  const child = spawn(`corepack pnpm ${pnpmScript}`, {
    cwd: root,
    env: { ...process.env, ...env },
    shell: true,
    windowsHide: true,
    stdio: ["ignore", fd, fd],
  });
  child.on("exit", (code, signal) => {
    try {
      fs.appendFileSync(logFile, `\n[${name} exit code=${code} signal=${signal}]\n`);
    } catch {
      /* log already closed */
    }
  });
  console.log(`${name}: corepack pnpm ${pnpmScript}  →  ${logFile}`);
  return { name, child, logFile };
}

function installShortcut() {
  const ps1 = path.join(scriptsDir, "install-desktop-shortcut.ps1");
  spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1],
    { cwd: root, stdio: "inherit" },
  );
}

function dockerCliOk() {
  return runQuiet("docker -v").status === 0;
}

function dockerReady() {
  return runQuiet("docker info").status === 0;
}

function dockerDesktopExe() {
  const homes = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA,
  ].filter(Boolean);
  for (const home of homes) {
    const candidate = path.join(home, "Docker", "Docker", "Docker Desktop.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function ensureDockerOnPath() {
  if (dockerCliOk()) return;
  const bin = path.join(
    process.env.ProgramFiles || "C:\\Program Files",
    "Docker",
    "Docker",
    "resources",
    "bin",
  );
  if (fs.existsSync(path.join(bin, "docker.exe"))) {
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  }
}

function startDockerDesktop() {
  const exe = dockerDesktopExe();
  if (!exe) {
    throw new Error(
      "Docker Desktop не найден. Установи его с https://www.docker.com/products/docker-desktop/",
    );
  }
  console.log(`Запускаю Docker Desktop: ${exe}`);
  spawn(exe, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  }).unref();
}

async function ensureDocker(seconds = 180) {
  ensureDockerOnPath();
  if (!dockerCliOk()) {
    const exe = dockerDesktopExe();
    if (!exe) {
      throw new Error(
        "Нет команды docker и нет Docker Desktop. Установи Docker Desktop и кликни ярлык снова.",
      );
    }
    startDockerDesktop();
    ensureDockerOnPath();
  } else if (!dockerReady()) {
    startDockerDesktop();
  }

  if (dockerReady()) {
    console.log("Docker уже готов.");
    return;
  }

  console.log(`Жду Docker Desktop (до ${seconds} с)…`);
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    ensureDockerOnPath();
    if (dockerReady()) {
      console.log("Docker готов.");
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    "Docker Desktop не стал Ready. Открой его вручную, дождись кита, затем кликни ярлык снова.",
  );
}

function postgresReady() {
  // Готовность проверяем TCP-соединением с настроенной БД (host/port из apps/api/.env):
  // postgres у пользователя может быть не докер-контейнером orion-postgres, а службой
  // или контейнером с другим именем — порт из конфигурации решает, а не имя контейнера.
  let url;
  try {
    const envFile = path.join(root, "apps", "api", ".env");
    const configured = (() => {
      for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
        const match = /^DATABASE_URL=(.*)$/.exec(line.trim());
        if (match) return match[1].replace(/^"(.*)"$/, "$1");
      }
      return "postgres://127.0.0.1:5433/orion";
    })();
    url = new URL(configured);
  } catch {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const socket = net.connect({ port: Number(url.port || 5432), host: url.hostname, timeout: 1500 });
    socket.once("connect", () => { socket.end(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
  });
}

async function main() {
  process.chdir(root);
  checkSingleInstance();
  writeLock();
  installShortcut();

  console.log(`ORION: ${root}`);
  console.log(
    "Окно берёт http://localhost:3011 — текущий Next.js, не собранный exe.",
  );

  await ensureDocker();

  console.log("Postgres…");
  run("corepack pnpm db:up");

  let pgOk = false;
  for (let i = 0; i < 120; i++) {
    if (await postgresReady()) {
      pgOk = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!pgOk) {
    throw new Error("PostgreSQL не отвечает на настроенном порту. Проверь, что БД запущена.");
  }

  const envFile = path.join(root, "apps", "api", ".env");
  const envExample = path.join(root, "apps", "api", ".env.example");
  if (!fs.existsSync(envFile)) {
    if (!fs.existsSync(envExample)) {
      throw new Error("Нет apps/api/.env и .env.example");
    }
    fs.copyFileSync(envExample, envFile);
    console.log("Скопирован apps/api/.env из примера. Поставь свои секреты, если нужно.");
  }

  console.log("Prisma generate + migrate deploy…");
  run("corepack pnpm db:generate");
  run("corepack pnpm --filter @orion/api prisma:migrate:deploy");

  let api = null;
  if (!(await tcpOpen(14000))) {
    console.log("API :14000…");
    // Порт этой рабочей копии задан умолчанием main.ts (14000): он не должен забирать
    // порт установленной беты (:4000). Явный PORT в env по-прежнему побеждает.
    api = startService("api", "dev:api");
    await waitApiReady(14000, 120, api);
  } else {
    // Something is already listening — could be our own previous run, or an
    // unrelated process. Confirm it's actually the ORION API by hitting
    // /system/health, don't just trust the open TCP port ("занят порт" done-
    // criterion): proceeding blind here would open the Tauri window against
    // a service that silently fails every API call.
    await waitApiReady(14000, 5, null);
    console.log("API уже слушает :14000");
  }

  let web = null;
  if (!(await tcpOpen(3011))) {
    console.log("Web :3011…");
    web = startService("web", "dev:web");
    await waitPort(3011, "Web", 120, web);
  } else {
    console.log("Web уже слушает :3011");
  }

  console.log("Окно Tauri (hot reload с :3011)…");
  try {
    run("corepack pnpm dev:desktop");
  } finally {
    killTree(api?.child);
    killTree(web?.child);
    releaseLock();
  }
}

main().catch((err) => {
  console.error("\nORION не запустился:");
  console.error(err.message || err);
  releaseLock();
  process.exit(1);
});

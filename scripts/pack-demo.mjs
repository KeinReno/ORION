#!/usr/bin/env node
/**
 * Builds a self-contained Windows demo folder:
 *   %USERPROFILE%\Desktop\Orion - Demo
 *
 * Includes portable Node, hoisted node_modules (copied, not store-linked),
 * and a shortcut. First click on the recipient PC only initialises a local
 * Postgres cluster and seeds the three demo accounts.
 */
import { spawnSync } from "node:child_process";
import { cpSync, createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEST = resolve(process.env.ORION_DEMO_DEST || join(homedir(), "Desktop", "Orion - Demo"));
const APP = join(DEST, "app");
const FILES = join(DEST, "Демонстрационный 1");
const RUNTIME = join(DEST, "runtime", "node");
const NODE_VERSION = "22.14.0";
const NODE_ZIP = `node-v${NODE_VERSION}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}`;

function robocopy() {
  const xd = [
    ".git",
    ".cursor",
    "graft",
    "tmp",
    "target",
    ".next",
    ".next-desktop",
    "out",
    ".claude",
    "node_modules",
    ".pnpm-store"
  ];
  const args = [
    ROOT,
    APP,
    "/E",
    "/XD",
    ...xd,
    ".data",
    "data",
    "/XF",
    "CLAUDE.md",
    ".autopilot.json",
    ".env",
    ".env.local",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS",
    "/nc",
    "/ns",
    "/np",
    "/SJ",
    "/SL",
    "/R:1",
    "/W:1"
  ];
  const result = spawnSync("robocopy", args, { stdio: "inherit", windowsHide: true });
  const code = result.status ?? 1;
  if (code >= 8) throw new Error(`robocopy завершился с кодом ${code}`);
}

function copyTree(from, to) {
  const skip = new Set([
    ".git",
    ".cursor",
    ".graft",
    "graft",
    "tmp",
    "target",
    ".next",
    ".next-desktop",
    "out",
    "data",
    ".claude",
    "node_modules"
  ]);
  cpSync(from, to, {
    recursive: true,
    filter: (source) => {
      const rel = source.slice(from.length).replace(/^[/\\]+/, "");
      if (!rel) return true;
      const parts = rel.split(/[/\\]/);
      if (parts.some((part) => skip.has(part))) return false;
      const norm = rel.replace(/\\/g, "/");
      if (norm === "CLAUDE.md" || norm.startsWith("docs/PLAN")) return false;
      if (norm.startsWith("apps/api/.data")) return false;
      if (norm.startsWith("infra/postgres/data")) return false;
      if (norm === ".autopilot.json") return false;
      return true;
    }
  });
}

const README = `ORION — демонстрационная сборка
================================

Автономная папка: Node.js внутри, интернет не нужен.
Рабочее пространство студии ООО «Северный контур».

Как запустить
-------------
1. Распакуйте архив на диск (путь без сетевой папки).
2. Дважды щёлкните ярлык «ORION» или файл «Запустить ORION.cmd».
3. Первый запуск создаёт локальную базу — около минуты.
4. В браузере откроется http://localhost:3020

Вход (пароль у всех: 1111)
--------------------------
  Мария Волкова   volkova@severny-kontur.ru    владелец
  Павел Орлов     orlov@severny-kontur.ru      тимлид
  Анна Белова     belova@severny-kontur.ru     участник

После входа откроется пространство «Демонстрационный 1».
Других учёток в этой сборке нет. Все модули включены и заполнены.

Что внутри
----------
Папка «Демонстрационный 1» рядом с ярлыком — те же файлы, что
в модуле «Документы».

  Дашборд, Инбокс, Задачи, Календарь, Заметки, Проекты,
  Время, Привычки, Списки, Финансы, Склад, Документы.

Клиенты: кафе «Северный ветер», АО «Балтийский причал»,
кондитерская «Ласточка» (архив), шоурум на Васильевском.

Остановка
---------
Закройте окно запуска или нажмите Enter в нём.

Сборка не для боевой эксплуатации: база слушает только localhost.
`;

const STARTER = `@echo off
chcp 65001 >nul
set "ROOT=%~dp0"
set "PATH=%ROOT%runtime\\node;%PATH%"
if not exist "%ROOT%runtime\\node\\node.exe" (
  echo В папке нет runtime\\node\\node.exe. Распакуйте архив целиком.
  pause
  exit /b 1
)
cd /d "%ROOT%app"
"%ROOT%runtime\\node\\node.exe" scripts\\launch-demo.mjs
if errorlevel 1 (
  echo.
  echo ORION не запустился. Смотрите сообщение выше.
  pause
)
`;

function stripFromCopy() {
  const extra = [
    join(APP, "CLAUDE.md"),
    join(APP, "docs", "PLAN.md"),
    join(APP, "infra", "postgres", "data"),
    join(APP, "apps", "api", ".data"),
    join(APP, "apps", "api", ".env"),
    join(APP, "apps", "web", ".env.local"),
    join(APP, ".claude")
  ];
  for (const path of extra) {
    rmSync(path, { recursive: true, force: true });
  }
}

function stopListening(port) {
  spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`
    ],
    { windowsHide: true }
  );
}

function killDemoFolderHolders() {
  spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `$dest = '${DEST.replace(/'/g, "''")}'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($dest) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
    ],
    { windowsHide: true }
  );
}

function stopDestPostgres() {
  const destNode = join(DEST, "runtime", "node", "node.exe");
  const destPg = join(APP, "scripts", "postgres.mjs");
  const dataDir = join(APP, "infra", "postgres", "data");
  if (existsSync(destPg)) {
    const node = existsSync(destNode) ? destNode : "node";
    spawnSync(node, [destPg, "down"], {
      cwd: APP,
      env: {
        ...process.env,
        ORION_PG_PORT: "5435",
        ORION_PG_DATA: dataDir
      },
      stdio: "ignore",
      windowsHide: true
    });
  }
  rmSync(join(dataDir, "postmaster.pid"), { force: true });
}

async function downloadNode() {
  mkdirSync(join(DEST, "runtime"), { recursive: true });
  const zipPath = join(tmpdir(), NODE_ZIP);
  console.log(`Скачиваю Node ${NODE_VERSION}…`);
  const res = await fetch(NODE_URL);
  if (!res.ok || !res.body) throw new Error(`Не удалось скачать ${NODE_URL}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));
  const expand = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${join(DEST, "runtime")}' -Force`
    ],
    { stdio: "inherit", windowsHide: true }
  );
  if ((expand.status ?? 1) !== 0) throw new Error("Не удалось распаковать Node");
  const extracted = join(DEST, "runtime", `node-v${NODE_VERSION}-win-x64`);
  rmSync(RUNTIME, { recursive: true, force: true });
  spawnSync("cmd", ["/c", "move", extracted, RUNTIME], { stdio: "inherit", windowsHide: true });
  if (!existsSync(join(RUNTIME, "node.exe"))) {
    throw new Error("portable Node не появился в runtime/node");
  }
}

function writeNpmrc() {
  writeFileSync(
    join(APP, ".npmrc"),
    ["node-linker=hoisted", "package-import-method=copy", "shamefully-hoist=true", ""].join("\n")
  );
}

function installDeps() {
  console.log("Ставлю зависимости внутрь сборки (копии, без pnpm-store)…");
  const node = join(RUNTIME, "node.exe");
  const enable = spawnSync(node, ["-e", "try{require('child_process').execSync('corepack enable',{stdio:'ignore'})}catch(e){}"], {
    cwd: APP,
    env: { ...process.env, PATH: `${RUNTIME};${process.env.PATH}` },
    windowsHide: true
  });
  void enable;
  const result = spawnSync("cmd", ["/c", "corepack pnpm install --offline false"], {
    cwd: APP,
    env: { ...process.env, PATH: `${RUNTIME};${process.env.PATH}` },
    stdio: "inherit",
    windowsHide: true
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error("pnpm install в сборке не удался");
  }
}

function writeShortcut() {
  const lnk = join(DEST, "ORION.lnk");
  const cmd = join(DEST, "Запустить ORION.cmd");
  const ps = [
    `$ws = New-Object -ComObject WScript.Shell`,
    `$s = $ws.CreateShortcut('${lnk.replace(/'/g, "''")}')`,
    `$s.TargetPath = '${cmd.replace(/'/g, "''")}'`,
    `$s.WorkingDirectory = '${DEST.replace(/'/g, "''")}'`,
    `$s.WindowStyle = 1`,
    `$s.Save()`
  ].join("; ");
  spawnSync("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true });
}

async function main() {
  console.log(`Сборка демо → ${DEST}`);
  stopListening(3020);
  stopListening(4010);
  stopDestPostgres();
  stopListening(5435);
  killDemoFolderHolders();

  mkdirSync(dirname(DEST), { recursive: true });
  rmSync(DEST, { recursive: true, force: true });
  mkdirSync(APP, { recursive: true });

  if (process.platform === "win32") {
    robocopy();
  } else {
    copyTree(ROOT, APP);
  }
  stripFromCopy();
  writeNpmrc();

  mkdirSync(FILES, { recursive: true });
  cpSync(join(ROOT, "scripts", "demo-content"), FILES, { recursive: true });

  await downloadNode();
  installDeps();

  writeFileSync(join(DEST, "Как пользоваться.txt"), README, "utf8");
  writeFileSync(join(DEST, "Запустить ORION.cmd"), STARTER, "utf8");
  writeFileSync(join(APP, "README.md"), README, "utf8");
  writeShortcut();

  console.log("Готово.");
  console.log(`  ${DEST}`);
  console.log("Ярлык: ORION.lnk");
  console.log("Вход: пароль 1111, три учётки студии, пространство «Демонстрационный 1»");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

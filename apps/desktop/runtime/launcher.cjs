/* eslint-disable @typescript-eslint/no-require-imports */
// Packaged local runtime. The NSIS install contains Node, PostgreSQL, Prisma,
// the compiled API and the static Tauri frontend. User data lives in LocalAppData.
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { effectiveDataDir, effectivePgDir, ensurePrivateDir, mirrorPgDir } = require('./ascii-path.cjs');
const payload = require('./payload.cjs');

// Tauri's Windows resource_dir can use the \\?\ extended path prefix.
// PostgreSQL initdb looks for postgres.exe beside itself and fails when that
// prefix is forwarded to its own process discovery logic.
const ordinaryWindowsPath = value => process.platform === 'win32'
  ? value.replace(/^[\\/]{2}\?[\\/](?=[A-Za-z]:)/, '')
  : value;
const runtime = ordinaryWindowsPath(path.resolve(__dirname, '..', 'runtime'));
let appRoot = runtime;
let api = path.join(appRoot, 'api');
let selection = null;
// ORION Rust: порты и каталог задаёт orion-rust/edition.json. Каталог установленной beta
// (`%LOCALAPPDATA%\ORION`) и её порты этот лаунчер не занимает.
// The edition is an immutable packaged runtime resource, not a path into the
// developer checkout (which does not exist on an installed system).
const edition = JSON.parse(fs.readFileSync(path.join(runtime, 'edition.json'), 'utf8'));
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const productionDirs = [
  path.join(localAppData, 'ORION'),
  path.join(localAppData, 'com.orion.desktop'),
  path.join(process.env.ProgramData || 'C:/ProgramData', 'ORION'),
];
// Resolve existing junctions/symlinks before both validation and use. Missing
// suffixes are appended to their real existing ancestor without creating them.
function resolvedPath(value) {
  let current = path.resolve(value);
  const suffix = [];
  for (;;) {
    try {
      return ordinaryWindowsPath(path.join(fs.realpathSync.native(current), ...suffix));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Refusing a dangling data-path link');
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}
// Кириллица в пути ломает initdb (см. ascii-path.cjs): журналы остаются там, где их ждёт оболочка, а база и бинарники
// PostgreSQL при не-ASCII пути переезжают в `%ProgramData%\ORION`.
const requestedData = resolvedPath(ordinaryWindowsPath(process.env.ORION_DESKTOP_DATA_DIR || path.join(localAppData, edition.dataDirName)));
const data = resolvedPath(effectiveDataDir(requestedData));
const appVersion = (() => { try { return require(path.join(api, 'package.json')).version; } catch { return 'dev'; } })();
const pgPlan = effectivePgDir(path.join(runtime, 'postgres'), appVersion);
const pgBin = path.join(pgPlan.dir, 'bin');
const cluster = path.join(data, 'postgres');
const configPath = path.join(data, 'local-runtime.json');
const pgPort = Number(process.env.ORION_DESKTOP_PG_PORT || edition.pgPort);
const apiPort = Number(process.env.ORION_DESKTOP_API_PORT || edition.apiPort);
const runtimePort = Number(process.env.ORION_RUST_RUNTIME_PORT || edition.runtimePort);

function assertEditionIsolation() {
  for (const candidate of [requestedData, data]) {
    const resolved = path.resolve(candidate);
    for (const production of productionDirs) {
      const root = resolvedPath(production);
      const insideProduction = resolved.toLowerCase() === root.toLowerCase()
        || resolved.toLowerCase().startsWith(root.toLowerCase() + path.sep);
      if (insideProduction) {
        throw new Error(`ORION Rust не использует каталог обычного ORION (${root}).`);
      }
    }
  }
  const ports = [apiPort, pgPort, runtimePort];
  if (ports.some(port => !Number.isInteger(port) || port <= 0 || port > 65535)
      || new Set(ports).size !== ports.length
      || ports.some(port => port === edition.forbiddenApiPort || port === edition.forbiddenPgPort || port === 5433)) {
    throw new Error(`ORION Rust не занимает порты обычного ORION (API ${edition.forbiddenApiPort}, PostgreSQL ${edition.forbiddenPgPort} или dev 5433); порты должны быть разными и допустимыми.`);
  }
}

function startRustRuntime() {
  const bin = process.env.ORION_RUST_RUNTIME_BIN
    || path.join(__dirname, '..', '..', '..', 'orion-rust', 'target', 'debug', 'orion-runtime.exe');
  if (!fs.existsSync(bin)) {
    log(`Rust runtime не собран (${bin}). Диагностика на 127.0.0.1:${runtimePort} появится после cargo build в orion-rust.`);
    return;
  }
  const child = spawn(bin, ['serve'], {
    env: {
      ...process.env,
      ORION_DESKTOP_DATA_DIR: requestedData,
      ORION_DESKTOP_API_PORT: String(apiPort),
      ORION_DESKTOP_PG_PORT: String(pgPort),
      ORION_RUST_RUNTIME_PORT: String(runtimePort),
    },
    windowsHide: true,
    stdio: 'ignore',
  });
  child.on('error', error => log(`Rust runtime не запустился: ${error.message}`));
  log(`Rust runtime слушает 127.0.0.1:${runtimePort}`);
}

function startupPhase(phase) {
  payload.atomic(path.join(requestedData, 'startup-state.json'), { phase });
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.mkdirSync(requestedData, { recursive: true });
  fs.appendFileSync(path.join(requestedData, 'runtime.log'), line);
  process.stdout.write(line);
}

function run(file, args, env = process.env, silent = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: api, env, windowsHide: true, stdio: silent ? 'ignore' : ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.stderr?.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`${path.basename(file)} exited ${code}: ${output.slice(-3000)}`)));
  });
}

function executable(name) { return path.join(pgBin, `${name}.exe`); }
function secret() { return randomBytes(36).toString('base64url'); }
function sqlString(value) { return `'${value.replaceAll("'", "''")}'`; }
function dbUrl(user, password, database) {
  return `postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:${pgPort}/${database}`;
}

function loadConfig() {
  fs.mkdirSync(data, { recursive: true });
  if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (fs.existsSync(path.join(cluster, 'PG_VERSION'))) {
    throw new Error('PostgreSQL data exists but local-runtime.json is missing. Restore the configuration from backup; data was not modified.');
  }
  const config = { adminPassword: secret(), appPassword: secret(), jwtSecret: secret(), syncSecret: randomBytes(32).toString('base64') };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
  return config;
}

async function startPostgres(config) {
  fs.mkdirSync(cluster, { recursive: true });
  if (!fs.existsSync(path.join(cluster, 'PG_VERSION'))) {
    log('Initializing private PostgreSQL cluster');
    const passwordFile = path.join(data, 'initdb-password.tmp');
    fs.writeFileSync(passwordFile, `${config.adminPassword}\n`, { mode: 0o600 });
    try {
      await run(executable('initdb'), [`--pgdata=${cluster}`, '--auth=scram-sha-256', '--username=orion', `--pwfile=${passwordFile}`, '--encoding=UTF8', '--locale=C']);
    } finally { fs.rmSync(passwordFile, { force: true }); }
  }
  try {
    await run(executable('pg_ctl'), ['status', '-D', cluster]);
    log('PostgreSQL already running');
  } catch {
    log(`Starting PostgreSQL on 127.0.0.1:${pgPort}`);
    await run(executable('pg_ctl'), ['start', '-w', '-D', cluster, '-l', path.join(data, 'postgres.log'), '-o', `-p ${pgPort} -h 127.0.0.1`], process.env, true);
  }
}

async function provision(config) {
  const { PrismaClient } = require(path.join(api, 'node_modules', '@prisma', 'client'));
  const admin = new PrismaClient({ datasources: { db: { url: dbUrl('orion', config.adminPassword, 'postgres') } } });
  try {
    const found = await admin.$queryRawUnsafe('SELECT 1 FROM pg_database WHERE datname = $1', 'orion');
    if (!found.length) await admin.$executeRawUnsafe('CREATE DATABASE orion');
  } finally { await admin.$disconnect(); }
  const db = new PrismaClient({ datasources: { db: { url: dbUrl('orion', config.adminPassword, 'orion') } } });
  try {
    const appRole = await db.$queryRawUnsafe("SELECT 1 FROM pg_roles WHERE rolname = 'orion_app'");
    if (!appRole.length) {
      log('Creating least-privilege database roles');
      await db.$executeRawUnsafe(`CREATE ROLE orion_app LOGIN PASSWORD ${sqlString(config.appPassword)} NOSUPERUSER NOBYPASSRLS`);
      await db.$executeRawUnsafe('CREATE ROLE orion_system NOLOGIN NOSUPERUSER BYPASSRLS');
      await db.$executeRawUnsafe('GRANT orion_system TO orion_app');
      await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO orion_app, orion_system');
      await db.$executeRawUnsafe('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orion_app, orion_system');
      await db.$executeRawUnsafe('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO orion_app, orion_system');
    }
  } finally { await db.$disconnect(); }
}

async function migrate(config) {
  log('Applying database migrations');
  const env = { ...process.env, DATABASE_URL: dbUrl('orion', config.adminPassword, 'orion') };
  const result = await run(process.execPath, [path.join(api, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy', `--schema=${path.join(api, 'prisma', 'schema.prisma')}`], env);
  log(result.trim().slice(-800));
}

// Метка сборки (`v0.1.0-windows-beta.3`) кладёт в runtime/build.json скрипт сборки установщика; без неё версия неизвестна.
function buildTag() {
  return buildInfo().tag;
}

// ORION-14: version/commit/builtAt from the same file, passed to the API so «Настройки → О программе»
// can show exactly what's installed — the thing a user can check without asking a developer to look at git log.
function buildInfo() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(appRoot, 'build.json'), 'utf8'));
    return { tag: parsed.tag || '', commit: parsed.commit || '', builtAt: parsed.builtAt || '' };
  } catch {
    return { tag: '', commit: '', builtAt: '' };
  }
}

function selectApplication() {
  selection = payload.select(runtime, data);
  appRoot = selection.root; api = path.join(appRoot, 'api');
  payload.atomic(path.join(requestedData, 'app-runtime.json'), { web: path.join(appRoot, 'web'), tag: buildTag() });
}

async function main() {
  assertEditionIsolation();
  startRustRuntime();
  if (data !== requestedData) {
    log(`Путь данных содержит не-ASCII символы (${requestedData}); данные и PostgreSQL хранятся в ${data}`);
    ensurePrivateDir(data);
  }
  if (pgPlan.copy) {
    log(`Каталог PostgreSQL содержит не-ASCII символы; копия бинарников: ${pgPlan.dir}`);
    mirrorPgDir(path.join(runtime, 'postgres'), pgPlan.dir, appVersion);
  }
  startupPhase('preparing');
  selectApplication();
  for (const file of [process.execPath, executable('initdb'), executable('pg_ctl'), path.join(api, 'dist', 'main.js')]) {
    if (!fs.existsSync(file)) throw new Error(`Installer is incomplete: ${file}`);
  }
  const config = loadConfig();
  startupPhase('database');
  await startPostgres(config);
  await provision(config);
  startupPhase('migrations');
  await migrate(config);
  const baseEnv = {
    ...process.env,
    NODE_ENV: 'production', APP_VERSION: require(path.join(api, 'package.json')).version,
    PORT: String(apiPort),
    DATABASE_URL: dbUrl('orion', config.adminPassword, 'orion'),
    APP_DATABASE_URL: dbUrl('orion_app', config.appPassword, 'orion'),
    JWT_SECRET: config.jwtSecret, SYNC_SECRET: config.syncSecret,
    STORAGE_DRIVER: 'local', STORAGE_DIR: path.join(data, 'documents'),
    // ТЗ-04: настройки узла (режим, устройства, сертификат) лежат рядом с данными; API сам перезапускается лаунчером.
    ORION_NODE_DIR: data, ORION_SUPERVISED: '1', ORION_EDITION: 'rust',
    // Обновления программы (apps/api/src/updates): метка сборки, каталог установки и способ штатно остановить PostgreSQL.
    // ORION_BUILD_COMMIT/ORION_BUILD_TIME (ORION-14): same build.json, surfaced in «О программе» so provenance
    // is checkable from inside a running install, not just by reading the staged runtime folder by hand.
    ORION_BUILD_TAG: buildInfo().tag, ORION_BUILD_COMMIT: buildInfo().commit, ORION_BUILD_TIME: buildInfo().builtAt, ORION_INSTALL_DIR: path.resolve(runtime, '..'),
    ORION_WEB_DIST: path.join(appRoot, 'web'),
    ORION_SHELL_RUNTIME: runtime,
    ORION_SHELL_BASE_TAG: JSON.parse(fs.readFileSync(path.join(runtime, 'build.json'), 'utf8')).tag,
    ORION_PG_CTL: executable('pg_ctl'), ORION_PG_CLUSTER: cluster,
  };
  startupPhase('server');
  superviseApi(baseEnv);
}

// ТЗ-04: «Хост LAN» — это тот же серверный режим (ORION_MODE=server), а не копия его проверок.
// HTTP остаётся на 127.0.0.1 для окна ORION этого ПК и проверки готовности, а сам API дополнительно
// слушает TLS на LAN-порту. PostgreSQL по-прежнему только на 127.0.0.1 (см. startPostgres).
// Адрес хоста для ссылок — домашний адаптер, а не первый попавшийся: на Windows первым часто идёт Hyper-V/WSL/VPN
// (тот же фильтр, что apps/api/src/lan/lan-scan.ts). Сначала 192.168.x.x, потом 10.x, потом 172.16–31.x.
const VIRTUAL_ADAPTER = /vethernet|hyper-v|wsl|virtualbox|vmware|vbox|docker|podman|br-|veth|utun|tun|tap|zerotier|tailscale|wireguard|hamachi|radmin|npcap|loopback/i;
function homeLanAddress() {
  const rank = a => (a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : 3);
  const all = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list || []).map(item => ({ name, item })))
    .filter(({ item }) => item && item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.'));
  const real = all.filter(({ name }) => !VIRTUAL_ADAPTER.test(name));
  const pick = (real.length > 0 ? real : all).sort((a, b) => rank(a.item.address) - rank(b.item.address))[0];
  return pick ? pick.item : null;
}

function lanEnv(forceLocal) {
  let node = null;
  try { node = JSON.parse(fs.readFileSync(path.join(data, 'lan-node.json'), 'utf8')); } catch { /* файла нет — «Локальный» */ }
  if (forceLocal || !node || node.mode !== 'host') return { ORION_MODE: 'local', HOST: '127.0.0.1' };
  const port = Number.isInteger(node.port) ? node.port : 4443;
  const address = homeLanAddress();
  return {
    ORION_MODE: 'server', ORION_LAN_HOST: '1', HOST: '127.0.0.1',
    PUBLIC_API_URL: `https://${address ? address.address : os.hostname()}:${port}`,
    WEB_ORIGINS: 'http://tauri.localhost',
  };
}

// The first line of the API's own error that says what went wrong («Конфигурация ORION_MODE=server небезопасна…»).
function failureReason(output) {
  const colors = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
  const lines = output.split(/\r?\n/).map(line => line.replace(colors, '').trim()).filter(Boolean);
  let at = lines.findIndex(line => /^Error: /.test(line));
  if (at < 0) at = lines.findIndex(line => /небезопасна|не удалось|EADDRINUSE|EACCES/i.test(line));
  if (at < 0) return (lines[lines.length - 1] || 'неизвестная ошибка').slice(0, 400);
  // «…запуск остановлен:» lists the problems on the next lines («- APP_DATABASE_URL …»): keep them.
  const details = [];
  for (let next = at + 1; next < lines.length && lines[next].startsWith('- '); next += 1) details.push(lines[next]);
  return [lines[at].replace(/^Error: /, ''), ...details].join(' ').slice(0, 400);
}

// `hostFailed`: the API did not start as «Хост LAN» — run it as «Локальный» once so this computer keeps working, and
// tell the settings why (ORION_LAN_HOST_FAILED → «Сеть и устройства»). Without this a failed host start left the window
// at «Локальный сервер ORION не отвечает» on every launch, the mode being saved.
function superviseApi(baseEnv, hostFailed) {
  const mode = lanEnv(Boolean(hostFailed));
  const ack = path.join(data, 'app-updates', `ui-ready-${randomBytes(16).toString('hex')}`);
  const trial = Boolean(selection?.trial);
  if (trial) fs.writeFileSync(ack, '', { flag: 'wx' });
  const env = { ...baseEnv, ORION_BUILD_TAG: buildTag(), ORION_WEB_DIST: path.join(appRoot, 'web'),
    ORION_PAYLOAD_FAILURE: payload.readState(data).failed ? 'Обновление не прошло проверку запуска. Восстановлена предыдущая версия приложения.' : '',
    ...(trial ? { ORION_PAYLOAD_ACK_FILE: ack } : {}), ...mode, ...(hostFailed ? { ORION_LAN_HOST_FAILED: `«Хост LAN» не запустился: ${hostFailed}` } : {}) };
  log(`Starting ORION API on 127.0.0.1:${apiPort} (${mode.ORION_LAN_HOST ? 'LAN host' : hostFailed ? 'local after a failed LAN host start' : 'local'})`);
  const child = spawn(process.execPath, [path.join(api, 'dist', 'main.js')], { cwd: api, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  let healthyTrial = false;
  let checking = false;
  let timer = null;
  if (trial) {
    const deadline = Date.now() + 150_000;
    timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        if (fs.existsSync(ack) && fs.readFileSync(ack, 'utf8') === buildTag()) {
          const response = await fetch(`http://127.0.0.1:${apiPort}/system/health`, { signal: AbortSignal.timeout(2000) });
          const health = await response.json();
          if (response.ok && health.database === 'ok') {
            payload.settle(data, true); healthyTrial = true; selection.trial = false;
            clearInterval(timer); fs.rmSync(ack, { force: true }); log('Application payload committed: API and UI ready');
          }
        }
      } catch { /* Keep the previous selection until both checks succeed. */ }
      finally { checking = false; }
      if (!healthyTrial && Date.now() > deadline) { clearInterval(timer); child.kill(); }
    }, 1000);
  }
  child.stdout.on('data', chunk => log(chunk.toString().trimEnd()));
  child.stderr.on('data', chunk => { const text = chunk.toString(); if (errors.length < 20000) errors += text; log(text.trimEnd()); });
  child.on('error', error => { log(`API failed: ${error.message}`); process.exitCode = 1; });
  child.on('exit', code => {
    if (timer) clearInterval(timer);
    fs.rmSync(ack, { force: true });
    if (trial && !healthyTrial) {
      log('Application payload failed readiness; restoring previous application');
      payload.settle(data, false); selectApplication();
      setTimeout(() => superviseApi(baseEnv, hostFailed), 500); return;
    }
    // 75 — API просит применить новый режим узла (Хост LAN ⇄ Локальный): перечитываем lan-node.json и поднимаем заново.
    if (code === 75) { log('API restarting to apply node mode'); setTimeout(() => superviseApi(baseEnv), 500); return; }
    if (mode.ORION_LAN_HOST && !hostFailed) {
      const reason = failureReason(errors);
      log(`API exited (${code}) as LAN host: ${reason}; starting as local`);
      setTimeout(() => superviseApi(baseEnv, reason), 500);
      return;
    }
    log(`API exited (${code})`); process.exitCode = code || 1;
  });
}

// Validate before the normal error handler: log() writes in requestedData and
// must never run when that very path was rejected as a Classic profile.
let isolationError = null;
try { assertEditionIsolation(); } catch (error) { isolationError = error; }
if (isolationError) {
  process.stderr.write(`Startup refused: ${isolationError.message}\n`);
  process.exitCode = 1;
} else main().catch(async error => {
  log(`Startup failed: ${error.message}`);
  if (selection?.trial) {
    payload.settle(data, false); selection.trial = false;
    log('Restoring previous application after startup failure');
    try { await main(); return; } catch (fallback) { log(`Fallback failed: ${fallback.message}`); }
  }
  process.exitCode = 1;
});

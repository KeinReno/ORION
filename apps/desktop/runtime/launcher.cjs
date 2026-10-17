/* eslint-disable @typescript-eslint/no-require-imports */
// Packaged local runtime. The NSIS install contains Node, PostgreSQL, Prisma,
// the compiled API and the static Tauri frontend. User data lives in LocalAppData.
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Tauri's Windows resource_dir can use the \\?\ extended path prefix.
// PostgreSQL initdb looks for postgres.exe beside itself and fails when that
// prefix is forwarded to its own process discovery logic.
const ordinaryWindowsPath = value => process.platform === 'win32'
  ? value.replace(/^[\\/]{2}\?[\\/](?=[A-Za-z]:)/, '')
  : value;
const runtime = ordinaryWindowsPath(path.resolve(__dirname, '..', 'runtime'));
const api = path.join(runtime, 'api');
const pgBin = path.join(runtime, 'postgres', 'bin');
const data = ordinaryWindowsPath(process.env.ORION_DESKTOP_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ORION'));
const cluster = path.join(data, 'postgres');
const configPath = path.join(data, 'local-runtime.json');
const pgPort = Number(process.env.ORION_DESKTOP_PG_PORT || 55432);
const apiPort = Number(process.env.ORION_DESKTOP_API_PORT || 4000);

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.mkdirSync(data, { recursive: true });
  fs.appendFileSync(path.join(data, 'runtime.log'), line);
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

async function main() {
  for (const file of [process.execPath, executable('initdb'), executable('pg_ctl'), path.join(api, 'dist', 'main.js')]) {
    if (!fs.existsSync(file)) throw new Error(`Installer is incomplete: ${file}`);
  }
  const config = loadConfig();
  await startPostgres(config);
  await provision(config);
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
    ORION_NODE_DIR: data, ORION_SUPERVISED: '1',
  };
  superviseApi(baseEnv);
}

// ТЗ-04: «Хост LAN» — это тот же серверный режим (ORION_MODE=server), а не копия его проверок.
// HTTP остаётся на 127.0.0.1 для окна ORION этого ПК и проверки готовности, а сам API дополнительно
// слушает TLS на LAN-порту. PostgreSQL по-прежнему только на 127.0.0.1 (см. startPostgres).
function lanEnv() {
  let node = null;
  try { node = JSON.parse(fs.readFileSync(path.join(data, 'lan-node.json'), 'utf8')); } catch { /* файла нет — «Локальный» */ }
  if (!node || node.mode !== 'host') return { ORION_MODE: 'local', HOST: '127.0.0.1' };
  const port = Number.isInteger(node.port) ? node.port : 4443;
  const address = Object.values(os.networkInterfaces()).flat().find(item => item && item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.'));
  return {
    ORION_MODE: 'server', ORION_LAN_HOST: '1', HOST: '127.0.0.1',
    PUBLIC_API_URL: `https://${address ? address.address : os.hostname()}:${port}`,
    WEB_ORIGINS: 'http://tauri.localhost',
  };
}

function superviseApi(baseEnv) {
  const mode = lanEnv();
  const env = { ...baseEnv, ...mode };
  log(`Starting ORION API on 127.0.0.1:${apiPort} (${mode.ORION_LAN_HOST ? 'LAN host' : 'local'})`);
  const child = spawn(process.execPath, [path.join(api, 'dist', 'main.js')], { cwd: api, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => log(chunk.toString().trimEnd()));
  child.stderr.on('data', chunk => log(chunk.toString().trimEnd()));
  child.on('error', error => { log(`API failed: ${error.message}`); process.exitCode = 1; });
  child.on('exit', code => {
    // 75 — API просит применить новый режим узла (Хост LAN ⇄ Локальный): перечитываем lan-node.json и поднимаем заново.
    if (code === 75) { log('API restarting to apply node mode'); setTimeout(() => superviseApi(baseEnv), 500); return; }
    log(`API exited (${code})`); process.exitCode = code || 1;
  });
}

main().catch(error => { log(`Startup failed: ${error.message}`); process.exitCode = 1; });

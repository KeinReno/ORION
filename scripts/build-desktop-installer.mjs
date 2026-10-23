#!/usr/bin/env node
// Run on Windows: builds the static web app and a self-contained NSIS package.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = join(root, 'apps', 'desktop', 'src-tauri', 'resources', 'runtime');
const api = join(stage, 'api');
const pgPackage = join(root, 'node_modules', '.pnpm', '@embedded-postgres+windows-x64@16.14.0-beta.17', 'node_modules', '@embedded-postgres', 'windows-x64', 'native');
function run(file, args, env = process.env) {
  console.log(`> ${file} ${args.join(' ')}`);
  execFileSync(file, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
}
function runPnpm(args, env = process.env) {
  // Windows cannot execFileSync a .cmd shim directly on current Node releases.
  const quote = value => /\s/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
  run('cmd.exe', ['/d', '/s', '/c', `corepack pnpm ${args.map(quote).join(' ')}`], env);
}
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 build host required');
if (!existsSync(pgPackage)) throw new Error('Embedded PostgreSQL Windows package is missing. Run pnpm install first.');
if (!existsSync(process.execPath)) throw new Error('Node runtime is missing');
runPnpm(['--filter', '@orion/api', 'build']);
runPnpm(['build:desktop-export'], { ...process.env, NEXT_PUBLIC_API_URL: 'http://localhost:4000' });
const expected = resolve(root, 'apps', 'desktop', 'src-tauri', 'resources', 'runtime');
if (resolve(stage) !== expected) throw new Error('Refusing to remove unexpected stage path');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
runPnpm(['--config.node-linker=hoisted', '--filter', '@orion/api', 'deploy', '--prod', api]);
for (const name of ['.env', '.env.example', '.data', 'apps', 'tmp', 'src', 'test', 'tsconfig.json', 'tsconfig.test.json']) {
  rmSync(join(api, name), { recursive: true, force: true });
}
if (existsSync(join(api, '.env'))) throw new Error('Secret .env would be bundled');
run(process.execPath, [join(api, 'node_modules', 'prisma', 'build', 'index.js'), 'generate', `--schema=${join(api, 'prisma', 'schema.prisma')}`], { ...process.env, DATABASE_URL: 'postgresql://placeholder:placeholder@127.0.0.1:5433/orion' });
cpSync(process.execPath, join(stage, 'node.exe'));
cpSync(pgPackage, join(stage, 'postgres'), { recursive: true });
cpSync(join(root, 'apps', 'desktop', 'runtime', 'launcher.cjs'), join(stage, 'launcher.cjs'));
cpSync(join(root, 'apps', 'desktop', 'runtime', 'ascii-path.cjs'), join(stage, 'ascii-path.cjs'));
// Метка сборки для проверки обновлений: ORION_BUILD_TAG=v0.1.0-windows-beta.3 pnpm build:desktop-installer (должна совпадать с тегом релиза).
const buildTag = process.env.ORION_BUILD_TAG || '';
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
writeFileSync(join(stage, 'build.json'), JSON.stringify({ tag: buildTag, commit, builtAt: new Date().toISOString() }, null, 2));
console.log(`Build tag: ${buildTag || '(не задана — обновления сочтут версию неизвестной)'} @ ${commit}`);
// Agent Manual (TZ-02): shipped beside the runtime so the «Подключить агента» wizard can show its real path.
cpSync(join(root, 'docs', 'AGENT_MANUAL.md'), join(stage, 'AGENT_MANUAL.md'));
// Страница телефона отдаётся самим API (GET /phone). Экспорт Next лежит либо в out/, либо в .next-desktop/.
const webExport = [join(root, 'apps', 'web', 'out'), join(root, 'apps', 'web', '.next-desktop')].find(
  (dir) => existsSync(join(dir, 'phone.html')) || existsSync(join(dir, 'phone', 'index.html'))
);
if (!webExport) throw new Error('В экспорте веб-клиента нет phone.html — телефон не сможет открыть страницу узла');
const skipExportDir = new Set(['cache', 'server', 'types', 'diagnostics', 'trace', 'standalone']);
cpSync(webExport, join(stage, 'web'), {
  recursive: true,
  filter: (src) => {
    const top = relative(webExport, src).split(/[\\/]/)[0];
    return !top || !skipExportDir.has(top);
  }
});
const mustExist = ['node.exe', 'postgres/bin/initdb.exe', 'postgres/bin/pg_ctl.exe', 'api/dist/main.js', 'api/prisma/schema.prisma', 'api/node_modules/prisma/build/index.js', 'launcher.cjs', 'ascii-path.cjs', 'AGENT_MANUAL.md', 'api/dist/mcp/orion-mcp.js'];
for (const name of mustExist) if (!existsSync(join(stage, name))) throw new Error(`Missing bundled runtime file: ${name}`);
const total = (directory) => readdirSync(directory, { withFileTypes: true }).reduce((sum, item) => sum + (item.isDirectory() ? total(join(directory, item.name)) : statSync(join(directory, item.name)).size), 0);
console.log(`Runtime ready: ${(total(stage) / 1024 / 1024).toFixed(1)} MiB`);
runPnpm(['--filter', '@orion/desktop', 'tauri:build']);

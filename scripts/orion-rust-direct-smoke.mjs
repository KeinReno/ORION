#!/usr/bin/env node
// Disposable end-to-end check for the packaged Rust supervisor. Never points at an existing profile.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const runtime = resolve(process.argv[2] || 'apps/desktop/src-tauri/resources/runtime');
const executable = resolve(process.argv[3] || 'orion-rust/target/release/orion-runtime.exe');
const existingProfile = process.env.ORION_SMOKE_PROFILE;
const profile = existingProfile ? resolve(existingProfile) : await mkdtemp(join(tmpdir(), 'orion-rust-direct-smoke-'));
const marker = join(profile, '.orion-smoke-owner');
if (existingProfile) {
  if (await readFile(marker, 'utf8') !== 'orion-rust-direct-smoke') throw new Error('Not a disposable ORION smoke profile');
} else {
  await writeFile(marker, 'orion-rust-direct-smoke', { flag: 'wx' });
}
if (!existingProfile && process.platform === 'win32') {
  const system = join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const sid = execFileSync(join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' })
    .trim().split(',')[1]?.replaceAll('"', '');
  if (!sid?.startsWith('S-1-')) throw new Error(`Cannot protect disposable profile ${profile}`);
  execFileSync(join(system, 'icacls.exe'), [profile, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '/grant', '*S-1-5-18:(OI)(CI)F', '/grant', '*S-1-5-32-544:(OI)(CI)F']);
}
if (!/^[\x20-\x7e]+$/.test(profile)) {
  if (!existingProfile) await rm(profile, { recursive: true, force: true });
  throw new Error('The temporary profile path must be ASCII to avoid using a shared fallback profile.');
}
async function freePort() {
  return new Promise((accept, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : accept(port));
    });
  });
}
const ports = new Set();
while (ports.size < 3) {
  const port = await freePort();
  if (![4000, 5433, 55432].includes(port)) ports.add(port);
}
const [api, pg, diagnostic] = ports;
const env = { ...process.env, ORION_RUNTIME_ROOT: runtime, ORION_DESKTOP_DATA_DIR: profile,
  ORION_DESKTOP_API_PORT: String(api), ORION_DESKTOP_PG_PORT: String(pg),
  ORION_RUST_RUNTIME_PORT: String(diagnostic), ORION_SHUTDOWN_ON_STDIN_EOF: '1' };
let safeToRemove = !existingProfile;
async function runOnce() {
  const started = performance.now();
  let lastPhase = '';
  const child = spawn(executable, ['supervise-direct'], { cwd: runtime, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-30000); });
  const closed = new Promise(resolveExit => child.once('close', (code, signal) => resolveExit({ code, signal })));
  let ready = false;
  let failure;
  const deadline = Date.now() + 180_000;
  try {
    while (Date.now() < deadline && child.exitCode === null && !child.signalCode) {
      if (process.env.ORION_SMOKE_TIMINGS === '1') {
        try {
          const phase = JSON.parse(await readFile(join(profile, 'startup-state.json'), 'utf8')).phase;
          if (phase !== lastPhase) {
            lastPhase = phase;
            console.log(`phase=${phase} elapsed_ms=${Math.round(performance.now() - started)}`);
          }
        } catch { /* The phase file may not have been created yet. */ }
      }
      try {
        const response = await fetch(`http://127.0.0.1:${api}/system/health`, { signal: AbortSignal.timeout(1500) });
        if (response.ok && (await response.json()).database === 'ok') {
          ready = true;
          if (process.env.ORION_SMOKE_TIMINGS === '1') console.log(`phase=ready elapsed_ms=${Math.round(performance.now() - started)}`);
          break;
        }
      } catch { /* Still starting. */ }
      await delay(500);
    }
    if (!ready) throw new Error(`Rust runtime failed to reach healthy API.\n${output}`);
  } catch (error) {
    failure = error;
  } finally {
    child.stdin.end();
    const result = await Promise.race([closed, delay(35_000, null, { ref: false })]);
    if (!result) {
      safeToRemove = false;
      child.kill();
      failure ||= new Error(`Runtime did not exit gracefully; profile preserved at ${profile}.\n${output}`);
    } else if (result.code !== 0) {
      failure ||= new Error(`Runtime exit ${result.code ?? result.signal}.\n${output}`);
    }
  }
  if (failure) throw failure;
  for (const port of [api, pg]) {
    const probe = createServer();
    await new Promise((ok, fail) => { probe.once('error', fail); probe.listen(port, '127.0.0.1', ok); });
    await new Promise((ok, fail) => probe.close(error => error ? fail(error) : ok()));
  }
}
try {
  await runOnce();
  if (process.env.ORION_SMOKE_ONCE !== '1') await runOnce();
  console.log('Rust packaged runtime: startup, health, graceful shutdown and released ports passed.');
} catch (error) {
  safeToRemove = false;
  console.error(`Disposable profile preserved for investigation: ${profile}`);
  throw error;
} finally {
  if (safeToRemove) await rm(profile, { recursive: true, force: true });
}

#!/usr/bin/env node
/**
 * Explicit, isolated cold-start measurement for two packaged ORION runtimes.
 * Windows only: the child is created through the native Habitat Job Object host.
 * Usage: node scripts/benchmark-packaged-runtimes.mjs --classic <absolute-runtime-dir> --rust <absolute-runtime-dir>
 * Output contains only labels, elapsed milliseconds, and fixed error codes.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, lstat, realpath, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultHost = join(repoRoot, 'packages', 'habitat-windows-host', 'out', 'Kaiden.Habitat.WindowsHost.exe');
const SYSTEM_PORTS = new Set([4000, 5433, 55432, 55442]);
const STARTUP_TIMEOUT_MS = 15 * 60 * 1000;
const HEALTH_INTERVAL_MS = 250;

export class BenchmarkError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function parseArgs(argv) {
  const result = { classic: null, rust: null, tempRoot: tmpdir(), host: defaultHost };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--help' || key === '-h') return { help: true };
    if (!['--classic', '--rust', '--temp-root', '--host'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new BenchmarkError('invalid_arguments');
    }
    const value = argv[++i];
    if (key === '--classic') result.classic = value;
    else if (key === '--rust') result.rust = value;
    else if (key === '--temp-root') result.tempRoot = value;
    else result.host = value;
  }
  if (!result.classic || !result.rust) throw new BenchmarkError('invalid_arguments');
  return result;
}

const asciiPath = value => /^[\x20-\x7E]+$/.test(value);
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

async function existsFile(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

export async function inspectRuntime(directory, kind = 'rust') {
  if (!isAbsolute(directory)) throw new BenchmarkError('runtime_path_must_be_absolute');
  const root = await realpath(directory).catch(() => { throw new BenchmarkError('runtime_unavailable'); });
  if (!(await stat(root)).isDirectory()) throw new BenchmarkError('runtime_unavailable');
  const editionPath = join(root, 'edition.json');
  let edition = null;
  try { edition = JSON.parse(await readFile(editionPath, 'utf8')); }
  catch (error) {
    if (kind !== 'classic' || error?.code !== 'ENOENT') throw new BenchmarkError('runtime_contract_invalid');
  }
  const required = [
    'node.exe', 'launcher.cjs', 'ascii-path.cjs', 'payload.cjs',
    'postgres', 'api',
  ];
  for (const name of required) {
    try { await stat(join(root, name)); } catch { throw new BenchmarkError('runtime_contract_invalid'); }
  }
  for (const name of ['postgres/bin/initdb.exe', 'postgres/bin/pg_ctl.exe', 'api/dist/main.js', 'api/prisma/schema.prisma']) {
    if (!(await existsFile(join(root, name)))) throw new BenchmarkError('runtime_contract_invalid');
  }
  if (kind === 'rust') {
    if (!edition || typeof edition !== 'object') throw new BenchmarkError('runtime_contract_invalid');
    for (const name of ['apiPort', 'pgPort', 'runtimePort']) {
      if (!Number.isInteger(edition[name]) || edition[name] < 1 || edition[name] > 65535) throw new BenchmarkError('runtime_contract_invalid');
    }
  } else if (kind !== 'classic') {
    throw new BenchmarkError('runtime_contract_invalid');
  }
  return { root, edition, kind };
}

async function bindProbe(port, host = '127.0.0.1') {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host, port, exclusive: true }, resolveListen);
  }).catch(error => {
    if (error?.code === 'EADDRINUSE' || error?.code === 'EACCES') throw new BenchmarkError('port_unavailable');
    throw new BenchmarkError('port_check_failed');
  });
  await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
}

export async function checkPortAvailable(port) { return bindProbe(port); }

async function getFreePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolveListen);
  }).catch(() => { throw new BenchmarkError('port_check_failed'); });
  const port = server.address().port;
  await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
  return port;
}

export async function allocatePorts(editions) {
  const reserved = new Set(SYSTEM_PORTS);
  for (const edition of editions) {
    if (!edition) continue;
    for (const key of ['apiPort', 'pgPort', 'runtimePort', 'forbiddenApiPort', 'forbiddenPgPort']) {
      if (Number.isInteger(edition[key])) reserved.add(edition[key]);
    }
  }
  const counts = editions.map((_, index) => index === 0 ? 2 : 3);
  const requiredCount = counts.reduce((sum, value) => sum + value, 0);
  const ports = [];
  while (ports.length < requiredCount) {
    const port = await getFreePort();
    if (reserved.has(port)) continue;
    reserved.add(port);
    ports.push(port);
  }
  // Recheck every selected port immediately before any runtime starts.
  for (const port of ports) await bindProbe(port);
  const sets = [];
  let offset = 0;
  for (const count of counts) {
    sets.push(ports.slice(offset, offset + count));
    offset += count;
  }
  return sets;
}

function powershellPath(env) {
  if (!env.SystemRoot) throw new BenchmarkError('windows_environment_unavailable');
  return join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function runPowerShell(script, env, timeout = 15000) {
  const powershell = powershellPath(env);
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, encoding: 'utf8', timeout, env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw new BenchmarkError('windows_verification_failed');
  return { status: result.status ?? 1, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() };
}

function quotePs(value) { return `'${String(value).replaceAll("'", "''")}'`; }

export function makeMinimalEnv({ profileRoot, dataRoot, sourceEnv = process.env, platform = process.platform }) {
  const env = sourceEnv;
  if (platform !== 'win32') throw new BenchmarkError('windows_only');
  const systemRoot = env.SystemRoot || env.WINDIR;
  if (!systemRoot || !asciiPath(systemRoot)) throw new BenchmarkError('windows_environment_unavailable');
  const system32 = join(systemRoot, 'System32');
  const safePath = [system32, systemRoot].join(';');
  return {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    PATH: safePath,
    TEMP: profileRoot,
    TMP: profileRoot,
    LOCALAPPDATA: dataRoot,
    ProgramData: dataRoot,
    ORION_DESKTOP_DATA_DIR: join(dataRoot, 'profile'),
  };
}

async function setAndVerifyPrivateAcl(directory, descendants, env) {
  const whoami = spawnSync(join(env.SystemRoot, 'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
    windowsHide: true, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000,
  });
  const sid = whoami.status === 0 ? whoami.stdout.match(/"(S-1-[0-9-]+)"/)?.[1] : null;
  if (!sid) throw new BenchmarkError('private_profile_acl_failed');
  const userAce = `*${sid}:(OI)(CI)F`;
  const systemAce = '*S-1-5-18:(OI)(CI)F';
  const icacls = spawnSync(join(env.SystemRoot, 'System32', 'icacls.exe'), [directory, '/inheritance:r', '/grant:r', userAce, systemAce], {
    windowsHide: true, env, stdio: 'ignore', timeout: 15000,
  });
  if (icacls.status !== 0) throw new BenchmarkError('private_profile_acl_failed');
  const checks = [directory, ...descendants].map((path, index) => `CheckAcl ${quotePs(path)} ${index === 0 ? '$true' : '$false'} ${index !== 0 ? '$true' : '$false'}`).join('; ');
  const ps = `$ErrorActionPreference='Stop'; $allowed=@(${quotePs(sid)},'S-1-5-18'); function CheckAcl($p,$protected,$inherited){$a=Get-Acl -LiteralPath $p; if([bool]$a.AreAccessRulesProtected -ne [bool]$protected){throw 'acl_protection'}; if($a.Access.Count -ne 2){throw 'acl_count'}; foreach($r in $a.Access){$s=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if([bool]$r.IsInherited -ne [bool]$inherited -or $r.AccessControlType -ne 'Allow' -or $s -notin $allowed){throw 'acl_entry'}}}; ${checks}; exit 0`;
  const result = runPowerShell(ps, env);
  if (result.status !== 0) throw new BenchmarkError('private_profile_acl_failed');
}

export function listenerOwnershipScript(port, hostPid, proof = null) {
  if (!Number.isInteger(port) || !Number.isInteger(hostPid)) throw new BenchmarkError('health_not_owned');
  if (proof && (!proof.executablePrefix || !proof.commandIncludes)) throw new BenchmarkError('health_not_owned');
  // pg_ctl exits after start, so the postmaster's parent is gone and a parent walk cannot reach the Job host.
  // The command line must name this run's cluster, and the executable must be that runtime's postgres.
  const commandProof = proof
    ? `$proc=Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$l.OwningProcess); $exe=if($proc){[string]$proc.ExecutablePath}else{''}; $hit=if($proc -and $proc.CommandLine){$proc.CommandLine.IndexOf(${quotePs(proof.commandIncludes)}, [StringComparison]::OrdinalIgnoreCase) -ge 0}else{$false}; if($exe.StartsWith(${quotePs(proof.executablePrefix)}, [StringComparison]::OrdinalIgnoreCase) -and ($hit -or $exe.EndsWith('postgres.exe', [StringComparison]::OrdinalIgnoreCase))){exit 0}; `
    : '';
  return `$ErrorActionPreference='Stop'; $l=Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object {$_.LocalAddress -in @('127.0.0.1','0.0.0.0','::1','::')} | Select-Object -First 1; if(-not $l){exit 2}; $m=@{}; foreach($p in Get-CimInstance Win32_Process){$m[[int]$p.ProcessId]=[int]$p.ParentProcessId}; $n=[int]$l.OwningProcess; for($i=0;$i -lt 64 -and $n -gt 0;$i++){if($n -eq ${hostPid}){exit 0}; if(-not $m.ContainsKey($n)){break}; $n=$m[$n]}; ${commandProof}exit 3`;
}

export async function listenerOwnedByHost(port, hostPid, env, proof = null) {
  const result = runPowerShell(listenerOwnershipScript(port, hostPid, proof), env);
  if (result.status !== 0 && proof) process.stderr.write(`listener_check:${port}:${result.status}:${result.stdout}:${result.stderr.slice(0, 400)}\n`);
  return result.status === 0;
}

export function runtimeHostRequest(runtime, ports) {
  const [apiPort, pgPort, runtimePort] = ports;
  const env = {
    ORION_DESKTOP_DATA_DIR: join(runtime.dataRoot, 'profile'),
    ORION_DESKTOP_API_PORT: String(apiPort),
    ORION_DESKTOP_PG_PORT: String(pgPort),
  };
  if (Number.isInteger(runtimePort)) env.ORION_RUST_RUNTIME_PORT = String(runtimePort);
  const minimalEnv = { ...runtime.env, ...env };
  const request = Buffer.from(JSON.stringify({
    Executable: join(runtime.runtimeRoot, 'node.exe'),
    Cwd: runtime.runtimeRoot,
    Args: [join(runtime.runtimeRoot, 'launcher.cjs')],
  }), 'utf8').toString('base64');
  return { request, minimalEnv, apiPort };
}

async function waitForHealth({ child, apiPort, env, startedAt, pgProof }) {
  const deadline = performance.now() + STARTUP_TIMEOUT_MS;
  while (performance.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new BenchmarkError('runtime_exited');
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/system/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const body = await response.json();
        if (body?.database === 'ok') {
          const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
          const pgPort = env.ORION_DESKTOP_PG_PORT ? Number(env.ORION_DESKTOP_PG_PORT) : NaN;
          if (!(await listenerOwnedByHost(apiPort, child.pid, env)) || !Number.isInteger(pgPort)
              || !(await listenerOwnedByHost(pgPort, child.pid, env, pgProof))) {
            throw new BenchmarkError('listener_not_owned');
          }
          return elapsedMs;
        }
      }
    } catch (error) {
      if (error instanceof BenchmarkError) throw error;
    }
    await delay(HEALTH_INTERVAL_MS);
  }
  throw new BenchmarkError('startup_timeout');
}

async function startRuntime(host, runtime, ports) {
  const setup = runtimeHostRequest(runtime, ports);
  for (const port of ports) await bindProbe(port);
  const startedAt = performance.now();
  const child = spawn(host, [setup.request], {
    cwd: runtime.runtimeRoot, env: setup.minimalEnv,
    windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let spawnFailed = false;
  child.on('error', () => { spawnFailed = true; });
  const closePromise = new Promise(resolveClose => child.once('close', resolveClose));
  // The launcher emits operational logs, which are intentionally drained and discarded.
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  child.stdin.end();
  let elapsedMs;
  let failure;
  let safeToCleanup = true;
  try {
    elapsedMs = await waitForHealth({
      child, apiPort: setup.apiPort, env: setup.minimalEnv, startedAt,
      pgProof: {
        executablePrefix: join(runtime.runtimeRoot, 'postgres', 'bin') + sep,
        commandIncludes: join(setup.minimalEnv.ORION_DESKTOP_DATA_DIR, 'postgres'),
      },
    });
  } catch (error) {
    failure = error instanceof BenchmarkError ? error.code : 'runtime_failed';
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill(); } catch { /* wait for close; cleanup is permitted only after confirmation */ }
    }
    const closed = await Promise.race([closePromise.then(() => true), delay(10000).then(() => false)]);
    if (!closed) {
      failure = 'process_cleanup_failed';
      safeToCleanup = false;
    } else {
      try { await waitPortsReleased(ports); }
      catch {
        failure = 'port_not_released';
        safeToCleanup = false;
      }
    }
  }
  if (spawnFailed && !failure) failure = 'job_host_start_failed';
  if (failure) {
    const error = new BenchmarkError(failure);
    error.safeToCleanup = safeToCleanup;
    throw error;
  }
  if (child.exitCode === null && child.signalCode === null) throw new BenchmarkError('process_cleanup_failed');
  return elapsedMs;
}

export function safeChildPath(root, candidate) {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = resolve(candidate);
  const rel = relative(absoluteRoot, absoluteCandidate);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new BenchmarkError('cleanup_path_invalid');
  return { absoluteRoot, absoluteCandidate };
}

async function canonicalizeExistingPrefix(value) {
  let current = resolve(value);
  const suffix = [];
  for (;;) {
    try { return resolve(join(await realpath(current), ...suffix)); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw new BenchmarkError('temp_root_isolation_check_failed');
      const parent = dirname(current);
      if (parent === current) throw new BenchmarkError('temp_root_isolation_check_failed');
      suffix.unshift(current.slice(parent.length + (current[parent.length] === sep ? 1 : 0)));
      current = parent;
    }
  }
}

function pathsOverlap(first, second) {
  const inside = (parent, child) => {
    const rel = relative(parent, child);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  };
  return inside(first, second) || inside(second, first);
}

export async function assertTempRootIsolated(tempRoot, runtimeRoots, env = process.env, home = homedir()) {
  const candidate = await canonicalizeExistingPrefix(tempRoot);
  const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
  const systemRoot = env.SystemRoot || env.WINDIR || 'C:\\Windows';
  const programData = env.ProgramData || join(dirname(systemRoot), 'ProgramData');
  const protectedRoots = [...runtimeRoots];
  for (const base of [local, programData]) {
    for (const name of ['ORION', 'ORION-Rust', 'com.orion.desktop', 'com.orion.rust.desktop']) {
      protectedRoots.push(join(base, name));
    }
  }
  for (const path of protectedRoots) {
    const protectedPath = await canonicalizeExistingPrefix(path);
    if (pathsOverlap(candidate, protectedPath)) throw new BenchmarkError('temp_root_overlaps_protected_path');
  }
  return candidate;
}

export async function waitPortsReleased(ports, timeout = 10000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    let free = true;
    for (const port of ports) {
      try { await bindProbe(port); }
      catch (error) {
        if (!(error instanceof BenchmarkError) || error.code !== 'port_unavailable') throw error;
        free = false;
      }
    }
    if (free) return;
    await delay(100);
  }
  throw new BenchmarkError('port_not_released');
}

async function assertNoReparsePoints(root, readdirImpl = readdir) {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdirImpl(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      const info = await lstat(full);
      if (info.isSymbolicLink() || entry.isSymbolicLink()) throw new BenchmarkError('cleanup_path_invalid');
      if (info.isDirectory()) pending.push(full);
    }
  }
}

export async function removeCreatedProfile(root, tempRoot, removeImpl = rm, readdirImpl = readdir) {
  const { absoluteRoot, absoluteCandidate } = safeChildPath(tempRoot, root);
  const rootInfo = await lstat(absoluteCandidate).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new BenchmarkError('cleanup_path_invalid');
  const resolvedProfile = await realpath(absoluteCandidate).catch(() => { throw new BenchmarkError('cleanup_path_invalid'); });
  const resolvedTemp = await realpath(tempRoot).catch(() => { throw new BenchmarkError('cleanup_path_invalid'); });
  if (resolvedProfile !== absoluteCandidate || resolvedTemp !== absoluteRoot) throw new BenchmarkError('cleanup_path_invalid');
  await assertNoReparsePoints(absoluteCandidate, readdirImpl);
  const retryable = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await removeImpl(absoluteCandidate, { recursive: true, force: false, maxRetries: 0 });
      return;
    } catch (error) {
      if (error?.code === 'ENOENT' && !(await lstat(absoluteCandidate).catch(() => null))) return;
      if (!retryable.has(error?.code) || attempt === 5) throw new BenchmarkError('profile_cleanup_failed');
      await delay(150 * (attempt + 1));
      // Check that the exact approved directory still resolves to itself before retrying.
      const stillThere = await lstat(absoluteCandidate).catch(() => null);
      if (!stillThere?.isDirectory() || stillThere.isSymbolicLink()
          || await realpath(absoluteCandidate).catch(() => '') !== absoluteCandidate) {
        throw new BenchmarkError('cleanup_path_invalid');
      }
      await assertNoReparsePoints(absoluteCandidate, readdirImpl);
    }
  }
}

async function prepareRun(runtimeInfo, label, tempRoot, host) {
  const sessionRoot = await mkdtemp(join(tempRoot, `orion-bench-${label}-`));
  const profileRoot = join(sessionRoot, 'process-temp');
  const dataRoot = join(sessionRoot, 'local-data');
  try {
    await mkdir(profileRoot, { recursive: false });
    await mkdir(dataRoot, { recursive: false });
    const env = makeMinimalEnv({ profileRoot, dataRoot });
    await setAndVerifyPrivateAcl(sessionRoot, [profileRoot, dataRoot], env);
    return { sessionRoot, profileRoot, dataRoot, runtimeRoot: runtimeInfo.root, edition: runtimeInfo.edition, env, host, label };
  } catch (error) {
    try { await removeCreatedProfile(sessionRoot, tempRoot); } catch { /* preserve the original fixed error */ }
    throw error;
  }
}

export async function runBenchmark({ classic, rust, tempRoot = tmpdir(), host = defaultHost }) {
  if (process.platform !== 'win32') throw new BenchmarkError('windows_only');
  if (![classic, rust, tempRoot, host].every(isAbsolute)) throw new BenchmarkError('paths_must_be_absolute');
  const realTempRoot = await realpath(tempRoot).catch(() => { throw new BenchmarkError('temp_root_unavailable'); });
  if (!asciiPath(realTempRoot)) throw new BenchmarkError('ascii_temp_root_required');
  if (!(await stat(realTempRoot)).isDirectory()) throw new BenchmarkError('temp_root_unavailable');
  if (!(await existsFile(host))) throw new BenchmarkError('job_host_unavailable');
  const runtimes = await Promise.all([inspectRuntime(classic, 'classic'), inspectRuntime(rust, 'rust')]);
  if (runtimes[0].root === runtimes[1].root) throw new BenchmarkError('runtimes_must_be_distinct');
  await assertTempRootIsolated(realTempRoot, runtimes.map(runtime => runtime.root));
  const portSets = await allocatePorts(runtimes.map(item => item.edition));
  const results = [];
  for (let index = 0; index < runtimes.length; index += 1) {
    const label = index === 0 ? 'classic' : 'rust';
    const run = await prepareRun(runtimes[index], label, realTempRoot, host);
    let result;
    let errorCode;
    let safeToCleanup = true;
    try { result = await startRuntime(host, run, portSets[index]); }
    catch (error) {
      errorCode = error instanceof BenchmarkError ? error.code : 'runtime_failed';
      safeToCleanup = error?.safeToCleanup !== false;
    }
    let cleanupCode;
    if (safeToCleanup) {
      try { await removeCreatedProfile(run.sessionRoot, realTempRoot); }
      catch (error) { cleanupCode = error instanceof BenchmarkError ? error.code : 'profile_cleanup_failed'; }
    } else {
      cleanupCode = 'cleanup_not_safe';
    }
    if (errorCode || cleanupCode) {
      const error = new BenchmarkError(`${label}_${errorCode || 'measurement_complete'}`);
      if (cleanupCode) error.cleanupCode = cleanupCode;
      throw error;
    }
    results.push({ runtime: label, apiDatabaseHealthyMs: result });
  }
  return {
    results,
    measurement: 'monotonic elapsed time from native Job host launch until an owned /system/health response with database=ok',
    limitation: 'API and database cold-start readiness only; no Tauri/WebView GUI readiness, CPU/RAM measurement, post-start performance, or repeated-run variance. The two runtimes start sequentially with fresh empty profiles.',
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write('Usage: node scripts/benchmark-packaged-runtimes.mjs --classic <absolute-runtime-dir> --rust <absolute-runtime-dir> [--temp-root <ASCII-absolute-dir>] [--host <absolute-windows-job-host>]\n');
      return;
    }
    const result = await runBenchmark(args);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof BenchmarkError ? error.code : 'benchmark_failed';
    const cleanup = error?.cleanupCode ? `;cleanup_failed:${error.cleanupCode}` : '';
    process.stderr.write(`benchmark_failed:${code}${cleanup}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

const MAX_TASK_BYTES = 64 * 1024;
const MAX_RUNTIME_MS = 60 * 60 * 1000;
const ENV_KEYS = ['PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'ComSpec'];

export class HabitatPolicyError extends Error {
  constructor(code) { super(code); this.name = 'HabitatPolicyError'; this.code = code; }
}

export function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || typeof value.enabled !== 'boolean' ||
      typeof value.workspaceRoot !== 'string' || !isAbsolute(value.workspaceRoot) || !Array.isArray(value.profiles) || value.profiles.length > 20) {
    throw new HabitatPolicyError('invalid_config');
  }
  const ids = new Set();
  for (const p of value.profiles) {
    if (!p || typeof p !== 'object' || !/^[a-z][a-z0-9-]{0,63}$/.test(p.id ?? '') || ids.has(p.id) ||
        typeof p.executable !== 'string' || !isAbsolute(p.executable) ||
        !Array.isArray(p.args) || p.args.length > 30 || p.args.some(arg => typeof arg !== 'string' || arg.length > 2048 || arg.includes('\0')) ||
        typeof p.approved !== 'boolean' || !Number.isInteger(p.timeoutMs) || p.timeoutMs < 1000 || p.timeoutMs > MAX_RUNTIME_MS) {
      throw new HabitatPolicyError('invalid_profile');
    }
    ids.add(p.id);
  }
  return value;
}

export async function loadConfig(configPath) {
  const data = await readFile(configPath, 'utf8');
  if (data.length > 64 * 1024) throw new HabitatPolicyError('config_too_large');
  let config;
  try { config = JSON.parse(data); } catch { throw new HabitatPolicyError('invalid_json'); }
  return validateConfig(config);
}

function within(root, candidate) {
  const diff = relative(root, candidate);
  return diff === '' || (diff !== '..' && !diff.startsWith(`..${sep}`) && !isAbsolute(diff));
}

export async function resolveWorkspaceDirectory(rootPath, cwdPath) {
  if (!isAbsolute(rootPath) || !isAbsolute(cwdPath)) throw new HabitatPolicyError('absolute_paths_required');
  let root, cwd;
  try { root = await realpath(rootPath); cwd = await realpath(cwdPath); }
  catch { throw new HabitatPolicyError('directory_unavailable'); }
  if (!within(root, cwd)) throw new HabitatPolicyError('outside_workspace');
  if (!(await stat(cwd)).isDirectory()) throw new HabitatPolicyError('not_a_directory');
  return { root, cwd };
}

export async function resolveTaskFile(root, cwd, taskPath) {
  if (!isAbsolute(taskPath)) throw new HabitatPolicyError('absolute_paths_required');
  let filename;
  try { filename = await realpath(taskPath); }
  catch { throw new HabitatPolicyError('task_unavailable'); }
  if (!within(root, filename) || !within(cwd, filename)) throw new HabitatPolicyError('task_outside_workdir');
  const details = await stat(filename);
  if (!details.isFile() || details.size > MAX_TASK_BYTES || details.size < 1) throw new HabitatPolicyError('invalid_task_file');
  return filename;
}

export async function probeProfiles(config) {
  validateConfig(config);
  return Promise.all(config.profiles.map(async profile => {
    try {
      const binary = await realpath(profile.executable);
      if (!(await stat(binary)).isFile()) throw Error('not a file');
      await access(binary, constants.X_OK);
      return { id: profile.id, installed: true, approved: profile.approved, enabled: config.enabled, auth: 'not_checked', execution: 'not_attempted' };
    } catch {
      return { id: profile.id, installed: false, approved: profile.approved, enabled: config.enabled, auth: 'not_checked', execution: 'not_attempted' };
    }
  }));
}

function executionEnv(env) {
  const result = {};
  for (const key of ENV_KEYS) if (typeof env[key] === 'string') result[key] = env[key];
  return { ...result, NO_COLOR: '1' };
}

/**
 * Explicit local operator action, not an Agent Hub HTTP endpoint. The caller
 * cannot supply a binary or argv: both come from the preapproved local profile.
 * This is a process guard, NOT an OS sandbox: the child still has the local
 * account's filesystem/network privileges. Use only with trusted CLI providers.
 */
export async function runApprovedProfile({ config, profileId, workdir, taskFile, acknowledged, signal, spawnImpl = spawn, env = process.env }) {
  validateConfig(config);
  if (!config.enabled || acknowledged !== true) throw new HabitatPolicyError('operator_approval_required');
  const profile = config.profiles.find(item => item.id === profileId);
  if (!profile || !profile.approved) throw new HabitatPolicyError('profile_not_approved');
  const { root, cwd } = await resolveWorkspaceDirectory(config.workspaceRoot, workdir);
  const source = await resolveTaskFile(root, cwd, taskFile);
  const executable = await realpath(profile.executable).catch(() => { throw new HabitatPolicyError('executable_missing'); });
  if (!(await stat(executable)).isFile()) throw new HabitatPolicyError('invalid_executable');
  await access(executable, constants.X_OK);
  const task = await readFile(source);
  if (task.length < 1 || task.length > MAX_TASK_BYTES) throw new HabitatPolicyError('invalid_task_file');
  if (signal?.aborted) throw new HabitatPolicyError('already_aborted');

  const startedAt = new Date().toISOString();
  const stdoutHash = createHash('sha256'), stderrHash = createHash('sha256');
  let stdoutBytes = 0, stderrBytes = 0;
  let outcome = 'exited', exitCode = null, exitSignal = null;
  const child = spawnImpl(executable, [...profile.args], {
    cwd, env: executionEnv(env), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  });
  const done = new Promise(resolveDone => {
    let settled = false;
    let escalation;
    const terminate = reason => {
      if (settled) return;
      outcome = reason;
      child.kill('SIGTERM');
      escalation = setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 2500);
      escalation.unref?.();
    };
    const timeout = setTimeout(() => terminate('timed_out'), profile.timeoutMs);
    const onAbort = () => terminate('stopped');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', buf => { stdoutBytes += buf.length; stdoutHash.update(buf); });
    child.stderr?.on('data', buf => { stderrBytes += buf.length; stderrHash.update(buf); });
    child.stdin?.on('error', () => { /* process may exit before stdin is written */ });
    child.stdin?.end(task);
    child.once('error', () => { outcome = 'spawn_error'; });
    child.once('close', (code, sig) => {
      settled = true;
      clearTimeout(timeout);
      clearTimeout(escalation);
      signal?.removeEventListener('abort', onAbort);
      exitCode = code;
      exitSignal = sig;
      resolveDone();
    });
  });
  await done;
  return {
    version: 1, id: randomUUID(), profileId, runtime: 'local-approved-cli',
    startedAt, endedAt: new Date().toISOString(), outcome,
    exitCode, exitSignal, timedOut: outcome === 'timed_out',
    taskSha256: createHash('sha256').update(task).digest('hex'),
    stdoutSha256: stdoutHash.digest('hex'), stderrSha256: stderrHash.digest('hex'),
    stdoutBytes, stderrBytes,
    /** This is NOT an evidence approval or a completed Agent Hub task. */
    verified: false
  };
}

export async function saveReceipt(config, receipt) {
  validateConfig(config);
  const { root } = await resolveWorkspaceDirectory(config.workspaceRoot, config.workspaceRoot);
  const target = join(root, '.orion', 'habitat-receipts');
  await mkdir(target, { recursive: true, mode: 0o700 });
  const canonical = await realpath(target);
  if (!within(root, canonical)) throw new HabitatPolicyError('receipt_outside_workspace');
  const file = join(canonical, `${receipt.id}.json`);
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(receipt, null, 2) + '\n'); }
  finally { await handle.close(); }
  return file;
}

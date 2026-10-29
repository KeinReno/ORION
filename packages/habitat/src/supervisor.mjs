import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { HabitatPolicyError, validateConfig } from './habitat.mjs';
import { requireLoopbackApiUrl } from './agent-hub-bridge.mjs';

const MAX_STATE_BYTES = 8192;

export function abortableSleep(ms, signal) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
    signal?.addEventListener('abort', done, { once: true });
  });
}

export function validateSupervisorPolicy(config) {
  validateConfig(config);
  const value = config.supervisor;
  if (!value || value.enabled !== true || !Number.isInteger(value.pollMs) || value.pollMs < 10_000 || value.pollMs > 300_000) {
    throw new HabitatPolicyError('supervisor_not_enabled');
  }
  return value;
}

async function stateDir(config) {
  const root = await realpath(config.workspaceRoot);
  const folder = join(root, '.orion', 'habitat');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const canonical = await realpath(folder);
  const diff = relative(root, canonical);
  if (isAbsolute(diff) || diff === '..' || diff.startsWith('..' + sep)) throw new HabitatPolicyError('state_dir_outside_workspace');
  return canonical;
}

async function writeState(dir, state) {
  const tempfile = join(dir, 'supervisor-' + randomUUID() + '.tmp');
  const handle = await open(tempfile, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(state, null, 2) + '\n');
  } finally { await handle.close(); }
  try { await rename(tempfile, join(dir, 'supervisor.json')); }
  catch (error) { await rm(tempfile, { force: true }); throw error; }
}

async function priorState(dir) {
  try {
    const text = await readFile(join(dir, 'supervisor.json'), 'utf8');
    if (text.length > MAX_STATE_BYTES) return null;
    const value = JSON.parse(text);
    return value?.version === 1 && typeof value.sessionId === 'string' ? value : null;
  } catch { return null; }
}

/** Local-only runtime monitor. No spawn, no claim, no remote transport. */
export async function superviseHabitat({
  config, apiUrl, token, acknowledged, signal, fetchImpl = fetch,
  maxPolls = Infinity, sleep = abortableSleep
}) {
  const policy = validateSupervisorPolicy(config);
  const origin = requireLoopbackApiUrl(apiUrl);
  if (acknowledged !== true || !config.enabled) throw new HabitatPolicyError('operator_approval_required');
  if (typeof token !== 'string' || !token.startsWith('orion_agt_')) throw new HabitatPolicyError('invalid_token');
  if (!(maxPolls === Infinity || (Number.isInteger(maxPolls) && maxPolls > 0))) throw new HabitatPolicyError('invalid_poll_count');
  if (signal?.aborted) throw new HabitatPolicyError('already_aborted');

  const dir = await stateDir(config);
  const lockfile = join(dir, 'supervisor.lock');
  let lock;
  try { lock = await open(lockfile, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new HabitatPolicyError('supervisor_already_locked'); throw error; }
  const previous = await priorState(dir);
  const state = {
    version: 1, sessionId: randomUUID(), pid: process.pid, mode: 'observe_only',
    status: 'starting', startedAt: new Date().toISOString(), lastPollAt: null,
    queueCount: null, previousSession: previous ? { id: previous.sessionId, interrupted: !['stopped', 'auth_denied'].includes(previous.status) } : null
  };
  let polls = 0;
  try {
    await lock.writeFile(JSON.stringify({ sessionId: state.sessionId, pid: process.pid }));
    await writeState(dir, state);
    while (!signal?.aborted && polls < maxPolls) {
      polls++;
      let denied = false;
      try {
        const response = await fetchImpl(origin + '/ai/v1/agent-hub/executions', {
          method: 'GET', headers: { Authorization: 'Bearer ' + token },
          signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(8000)])
        });
        if (response.status === 401 || response.status === 403) {
          denied = true;
          state.status = 'auth_denied';
        } else if (!response.ok) {
          state.status = 'offline';
          state.queueCount = null;
        } else {
          const rows = await response.json();
          if (!Array.isArray(rows) || rows.length > 100) throw new HabitatPolicyError('invalid_queue');
          state.status = 'observing';
          state.queueCount = rows.filter(row => row?.status === 'queued').length;
        }
      } catch {
        state.status = 'offline';
        state.queueCount = null;
      }
      state.lastPollAt = new Date().toISOString();
      await writeState(dir, state);
      if (denied || signal?.aborted || polls >= maxPolls) break;
      await sleep(policy.pollMs, signal);
    }
    if (state.status !== 'auth_denied') state.status = 'stopped';
    await writeState(dir, state);
    return { ...state, polls };
  } finally {
    await lock.close();
    await rm(lockfile, { force: true });
  }
}

/** Observation freshness is not process attestation or a remote online claim. */
export async function readSupervisorStatus(config, now = Date.now()) {
  validateConfig(config);
  const pollMs = config.supervisor?.pollMs;
  if (!Number.isInteger(pollMs) || pollMs < 10_000 || pollMs > 300_000) throw new HabitatPolicyError('invalid_supervisor_policy');
  const state = await priorState(await stateDir(config));
  if (!state) return { state: null, freshObservation: false };
  const timestamp = Date.parse(state.lastPollAt ?? '');
  const freshObservation = state.status === 'observing' && Number.isFinite(timestamp) && now >= timestamp && now - timestamp <= 2 * pollMs;
  return { state, freshObservation };
}

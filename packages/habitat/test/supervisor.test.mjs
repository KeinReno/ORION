import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { superviseHabitat, validateSupervisorPolicy } from '../src/supervisor.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'habitat-supervisor-'));
  return { root, config: { version: 1, enabled: true, workspaceRoot: root, profiles: [], supervisor: { enabled: true, pollMs: 10000 } } };
}
const args = (config, extra = {}) => ({ config, apiUrl: 'http://127.0.0.1:4000', token: 'orion_agt_TEST_ONLY', acknowledged: true, maxPolls: 1, ...extra });
const ok = async () => ({ status: 200, ok: true, json: async () => [{ status: 'queued' }, { status: 'claimed' }] });

test('must explicitly enable monitor and acknowledge local operation', async () => {
  const { config } = await fixture();
  config.supervisor.enabled = false;
  assert.throws(() => validateSupervisorPolicy(config), /supervisor_not_enabled/);
  config.supervisor.enabled = true;
  await assert.rejects(superviseHabitat(args(config, { acknowledged: false, fetchImpl: ok })), /operator_approval_required/);
});

test('writes a secret-free observation and stops cleanly', async () => {
  const { root, config } = await fixture();
  const state = await superviseHabitat(args(config, { fetchImpl: ok }));
  assert.equal(state.status, 'stopped');
  assert.equal(state.queueCount, 1);
  assert.equal(state.mode, 'observe_only');
  const stored = await readFile(join(root, '.orion', 'habitat', 'supervisor.json'), 'utf8');
  assert.equal(stored.includes('orion_agt_'), false);
  assert.equal(stored.includes('TEST_ONLY'), false);
});

test('restart detects unclean prior status but never claims execution', async () => {
  const { root, config } = await fixture();
  const directory = join(root, '.orion', 'habitat');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'supervisor.json'), JSON.stringify({ version: 1, sessionId: 'former', status: 'observing' }));
  let calls = 0;
  const state = await superviseHabitat(args(config, { fetchImpl: async (url, req) => {
    calls++;
    assert.equal(req.method, 'GET');
    return ok();
  } }));
  assert.deepEqual(state.previousSession, { id: 'former', interrupted: true });
  assert.equal(calls, 1);
});

test('authorization loss is terminal, no repeated token use', async () => {
  const { config } = await fixture();
  let count = 0;
  const state = await superviseHabitat(args(config, { maxPolls: 3, fetchImpl: async () => {
    count++;
    return { status: 401, ok: false };
  } }));
  assert.equal(state.status, 'auth_denied');
  assert.equal(count, 1);
});

test('locks out concurrent monitor and leaves first session intact', async () => {
  const { config } = await fixture();
  let release;
  const blocked = new Promise(r => { release = r; });
  let started;
  const active = new Promise(r => { started = r; });
  const first = superviseHabitat(args(config, { maxPolls: 2, fetchImpl: ok, sleep: () => { started(); return blocked; } }));
  await active;
  await assert.rejects(superviseHabitat(args(config, { fetchImpl: ok })), /supervisor_already_locked/);
  release();
  await first;
});

test('rejects non-loopback addresses before contacting anything', async () => {
  const { config } = await fixture();
  await assert.rejects(superviseHabitat(args(config, { apiUrl: 'http://192.168.1.10:4000', fetchImpl: ok })), /non_loopback_api_url/);
});

test('abort interrupts polling interval and releases instance lock', async () => {
  const { config } = await fixture();
  const controller = new AbortController();
  let contacted;
  const call = new Promise(resolve => { contacted = resolve; });
  const monitor = superviseHabitat(args(config, { maxPolls: 3, signal: controller.signal, fetchImpl: async () => { contacted(); return ok(); } }));
  await call;
  controller.abort();
  const state = await monitor;
  assert.equal(state.status, 'stopped');
  const next = await superviseHabitat(args(config, { fetchImpl: ok }));
  assert.equal(next.status, 'stopped');
});

test('status is local observation, never proof of an online executor', async () => {
  const { root, config } = await fixture();
  const path = join(root, '.orion', 'habitat');
  await mkdir(path, { recursive: true });
  const time = new Date().toISOString();
  await writeFile(join(path, 'supervisor.json'), JSON.stringify({ version: 1, sessionId: 'x', status: 'observing', lastPollAt: time }));
  const { readSupervisorStatus } = await import('../src/supervisor.mjs');
  assert.equal((await readSupervisorStatus(config)).freshObservation, true);
  assert.equal((await readSupervisorStatus(config, Date.parse(time) + 30_000)).freshObservation, false);
});

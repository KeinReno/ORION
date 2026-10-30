import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { requireLoopbackApiUrl, runAgentHubExecution } from '../src/agent-hub-bridge.mjs';

async function fixtures() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'habitat-bridge-'));
  const workdir = join(workspaceRoot, 'repo');
  await mkdir(workdir);
  const taskFile = join(workdir, 'task.txt');
  await writeFile(taskFile, 'Fix a controlled test');
  const config = { version: 1, enabled: true, workspaceRoot, profiles: [{ id: 'test', executable: process.execPath, args: [], approved: true, timeoutMs: 5000 }] };
  return { config, workdir, taskFile };
}

function mockHub() {
  let revision = 0;
  let status = 'queued';
  const events = [];
  const fetchImpl = async (url, request) => {
    const action = url.endsWith('/claim') ? 'claim' : url.endsWith('/report') ? JSON.parse(request.body).action : 'list';
    events.push({ action, body: request.body ? JSON.parse(request.body) : null });
    if (action === 'list') return { ok: true, json: async () => [{ id: 'run-1', status, revision }] };
    assert.equal(request.headers.Authorization, 'Bearer TEST_ONLY');
    const requestRevision = JSON.parse(request.body).expectedRevision;
    assert.equal(requestRevision, revision);
    revision++;
    status = action === 'claim' ? 'claimed' : action === 'start' ? 'working' : action === 'submit' ? 'review' : action === 'fail' ? 'failed' : status;
    return { ok: true, json: async () => ({ id: 'run-1', revision, status }) };
  };
  return { fetchImpl, events };
}
const args = (e, hub, runImpl) => ({ ...e, apiUrl: 'http://127.0.0.1:4000', token: 'TEST_ONLY', executionId: 'run-1', profileId: 'test', acknowledged: true,
  fetchImpl: hub.fetchImpl, runImpl, saveReceiptImpl: async () => 'local-receipt.json' });

test('accepts only local loopback HTTP endpoints for bearer token', () => {
  assert.equal(requireLoopbackApiUrl('http://127.0.0.1:4000'), 'http://127.0.0.1:4000');
  for (const url of ['https://external.test', 'http://192.168.0.20:4000', 'http://user:password@localhost:4000', 'http://localhost:4000/path']) {
    assert.throws(() => requireLoopbackApiUrl(url));
  }
});

test('claim -> start -> submit only enters review; receipt is local and unverified', async () => {
  const e = await fixtures(), hub = mockHub();
  const result = await runAgentHubExecution(args(e, hub, async () => ({ id: 'receipt-1', outcome: 'exited', exitCode: 0, verified: false })));
  assert.equal(result.execution.status, 'review');
  assert.equal(result.receipt.verified, false);
  assert.deepEqual(hub.events.map(x => x.action), ['list', 'claim', 'start', 'submit']);
  assert.deepEqual(hub.events.at(-1).body.evidenceRefs, ['habitat-local-receipt:receipt-1']);
});

test('failed local process is reported failed, never submitted or done', async () => {
  const e = await fixtures(), hub = mockHub();
  const result = await runAgentHubExecution(args(e, hub, async () => ({ id: 'receipt-2', outcome: 'exited', exitCode: 1, verified: false })));
  assert.equal(result.execution.status, 'failed');
  assert.deepEqual(hub.events.map(x => x.action), ['list', 'claim', 'start', 'fail']);
});

test('local approval refusal occurs before any API claim or token use', async () => {
  const e = await fixtures(), hub = mockHub();
  await assert.rejects(runAgentHubExecution({ ...args(e, hub, async () => { throw Error('must not run'); }), acknowledged: false }), /operator_approval_required/);
  assert.deepEqual(hub.events, []);
});

test('heartbeat authorization failure aborts local execution and never submits', async () => {
  const e = await fixtures(), hub = mockHub();
  const fetchImpl = async (url, req) => {
    if (url.endsWith('/report') && JSON.parse(req.body).action === 'heartbeat') return { ok: false, status: 401 };
    return hub.fetchImpl(url, req);
  };
  let aborted = false;
  const runImpl = async ({ signal }) => new Promise(resolve => {
    signal.addEventListener('abort', () => { aborted = true; resolve({ id: 'stopped', outcome: 'stopped', exitCode: null, verified: false }); }, { once: true });
  });
  await assert.rejects(runAgentHubExecution({ ...args(e, hub, runImpl), fetchImpl, heartbeatMs: 100 }), /agent_hub_http_401/);
  assert.equal(aborted, true);
  assert.deepEqual(hub.events.map(v => v.action), ['list', 'claim', 'start']);
});

test('human cancellation aborts a running local process before the next heartbeat', async () => {
  const e = await fixtures(), hub = mockHub();
  let queueReads = 0;
  const fetchImpl = async (url, req) => {
    if (req.method === 'GET' && ++queueReads > 1) {
      return { ok: true, json: async () => [] }; // canceled runs leave the worker queue
    }
    return hub.fetchImpl(url, req);
  };
  let aborted = false;
  const runImpl = async ({ signal }) => new Promise(resolve => {
    signal.addEventListener('abort', () => { aborted = true; resolve({ id: 'stopped', outcome: 'stopped', exitCode: null, verified: false }); }, { once: true });
  });
  await assert.rejects(runAgentHubExecution({ ...args(e, hub, runImpl), fetchImpl, cancelPollMs: 100 }), /execution_no_longer_active/);
  assert.equal(aborted, true);
  assert.equal(hub.events.some(v => v.action === 'submit'), false);
  assert.equal(hub.events.some(v => v.action === 'heartbeat'), false);
});

test('token revocation on read-only poll aborts local execution without submitting evidence', async () => {
  const e = await fixtures(), hub = mockHub();
  let queueReads = 0;
  const fetchImpl = async (url, req) => {
    if (req.method === 'GET' && ++queueReads > 1) return { ok: false, status: 401 };
    return hub.fetchImpl(url, req);
  };
  let aborted = false;
  const runImpl = async ({ signal }) => new Promise(resolve => {
    signal.addEventListener('abort', () => { aborted = true; resolve({ id: 'stopped', outcome: 'stopped', exitCode: null, verified: false }); }, { once: true });
  });
  await assert.rejects(runAgentHubExecution({ ...args(e, hub, runImpl), fetchImpl, cancelPollMs: 100 }), /agent_hub_http_401/);
  assert.equal(aborted, true);
  assert.equal(hub.events.some(v => v.action === 'submit'), false);
});

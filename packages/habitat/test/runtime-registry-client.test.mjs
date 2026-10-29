import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntimeRegistryClient } from '../src/runtime-registry-client.mjs';

const id = 'deafbeef-8e33-4c89-b203-8aaa10837100';

test('register/pulse/close are fixed capability observer-only calls', async () => {
  let rev = -1;
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, method: options.method, body: JSON.parse(options.body), token: options.headers.Authorization });
    rev++;
    return { ok: true, json: async () => ({ id, revision: rev, presence: rev === 2 ? 'closed' : 'recent' }) };
  };
  const client = createRuntimeRegistryClient({ apiUrl: 'http://127.0.0.1:4000', token: 'orion_agt_TEST_ONLY', fetchImpl });
  assert.equal((await client.register(id)).revision, 0);
  assert.equal((await client.pulse(id, 0)).revision, 1);
  assert.equal((await client.close(id, 1)).presence, 'closed');
  assert.deepEqual(requests.map(v => v.method), ['POST', 'POST', 'POST']);
  assert.deepEqual(requests[0].body.capabilities, { canStart: false, canCancel: false, canObserve: true, canResume: false });
  assert.ok(requests.every(v => v.token === 'Bearer orion_agt_TEST_ONLY'));
});

test('fails closed on remote hosts and unauthorized or malformed server responses', async () => {
  assert.throws(() => createRuntimeRegistryClient({ apiUrl: 'http://192.168.1.12:4000', token: 'orion_agt_TEST_ONLY' }), /non_loopback_api_url/);
  const unauthorized = createRuntimeRegistryClient({ apiUrl: 'http://localhost:4000', token: 'orion_agt_TEST_ONLY', fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(unauthorized.register(id), /runtime_registry_http_401/);
  const bad = createRuntimeRegistryClient({ apiUrl: 'http://localhost:4000', token: 'orion_agt_TEST_ONLY', fetchImpl: async () => ({ ok: true, json: async () => ({ revision: 0 }) }) });
  await assert.rejects(bad.register(id), /invalid_runtime_registry_response/);
});

test('never sends a privileged runtime profile or accepts negative revisions', async () => {
  const client = createRuntimeRegistryClient({ apiUrl: 'http://localhost:4000', token: 'orion_agt_TEST_ONLY', fetchImpl: async () => { throw Error('must not call'); } });
  assert.throws(() => client.pulse(id, -1), /invalid_revision/);
  assert.throws(() => client.register('not-a-uuid'), /invalid_session_id/);
});

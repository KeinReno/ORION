import { stat, realpath } from 'node:fs/promises';
import { HabitatPolicyError, resolveTaskFile, resolveWorkspaceDirectory, runApprovedProfile, saveReceipt, validateConfig } from './habitat.mjs';

export function requireLoopbackApiUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new HabitatPolicyError('invalid_api_url'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new HabitatPolicyError('non_loopback_api_url');
  }
  return url.origin;
}

async function preflight(config, profileId, workdir, taskFile, acknowledged) {
  validateConfig(config);
  if (!config.enabled || acknowledged !== true) throw new HabitatPolicyError('operator_approval_required');
  const profile = config.profiles.find(p => p.id === profileId);
  if (!profile?.approved) throw new HabitatPolicyError('profile_not_approved');
  const { root, cwd } = await resolveWorkspaceDirectory(config.workspaceRoot, workdir);
  await resolveTaskFile(root, cwd, taskFile);
  const binary = await realpath(profile.executable).catch(() => { throw new HabitatPolicyError('executable_missing'); });
  if (!(await stat(binary)).isFile()) throw new HabitatPolicyError('invalid_executable');
}

/**
 * An operator-initiated local bridge to the existing F2 API. It is NOT a daemon
 * and has no authority to mark a Task done or verify evidence. The ORION agent
 * token is used solely for scoped HTTP requests, never passed to the child.
 */
export async function runAgentHubExecution({
  apiUrl, token, executionId, config, profileId, workdir, taskFile,
  acknowledged, fetchImpl = fetch, runImpl = runApprovedProfile,
  saveReceiptImpl = saveReceipt, heartbeatMs = 60_000
}) {
  const origin = requireLoopbackApiUrl(apiUrl);
  if (!token || typeof token !== 'string' || !executionId || typeof executionId !== 'string') throw new HabitatPolicyError('missing_credentials_or_execution');
  if (!Number.isInteger(heartbeatMs) || heartbeatMs < 100 || heartbeatMs > 90_000) throw new HabitatPolicyError('invalid_heartbeat_period');
  await preflight(config, profileId, workdir, taskFile, acknowledged);

  async function call(method, route, body) {
    const response = await fetchImpl(origin + '/ai/v1/agent-hub' + route, {
      method,
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw new HabitatPolicyError('agent_hub_http_' + response.status);
    const data = await response.json();
    if (!data || typeof data !== 'object') throw new HabitatPolicyError('invalid_agent_hub_response');
    return data;
  }
  const route = '/executions/' + encodeURIComponent(executionId);
  const queue = await call('GET', '/executions');
  if (!Array.isArray(queue)) throw new HabitatPolicyError('invalid_agent_hub_response');
  const target = queue.find(run => run?.id === executionId && run?.status === 'queued');
  if (!target || !Number.isInteger(target.revision)) throw new HabitatPolicyError('execution_not_queued');

  let latest = await call('POST', route + '/claim', { expectedRevision: target.revision });
  latest = await call('POST', route + '/report', { expectedRevision: latest.revision, action: 'start' });
  const controller = new AbortController();
  let stopped = false;
  let heartbeatProblem = null;
  let heartbeatQueue = Promise.resolve();
  const timer = setInterval(() => {
    heartbeatQueue = heartbeatQueue.then(async () => {
      if (stopped) return;
      try {
        latest = await call('POST', route + '/report', { expectedRevision: latest.revision, action: 'heartbeat' });
      } catch (error) {
        heartbeatProblem = error;
        controller.abort();
      }
    });
    heartbeatQueue.catch(error => { heartbeatProblem = error; controller.abort(); });
  }, heartbeatMs);

  let receipt;
  try {
    receipt = await runImpl({ config, profileId, workdir, taskFile, acknowledged, signal: controller.signal });
  } catch (error) {
    stopped = true;
    clearInterval(timer);
    await heartbeatQueue;
    try { await call('POST', route + '/report', { expectedRevision: latest.revision, action: 'fail', reason: 'local_process_error' }); }
    catch { /* losing lease is an error; do not mask original failure */ }
    throw error;
  }
  stopped = true;
  clearInterval(timer);
  await heartbeatQueue;
  if (heartbeatProblem) throw heartbeatProblem;

  const receiptFile = await saveReceiptImpl(config, receipt);
  if (receipt.outcome === 'exited' && receipt.exitCode === 0) {
    const reviewed = await call('POST', route + '/report', {
      expectedRevision: latest.revision, action: 'submit', evidenceRefs: ['habitat-local-receipt:' + receipt.id]
    });
    return { receiptFile, receipt, execution: reviewed };
  }
  const failed = await call('POST', route + '/report', {
    expectedRevision: latest.revision, action: 'fail', reason: 'local_process_' + receipt.outcome
  });
  return { receiptFile, receipt, execution: failed };
}

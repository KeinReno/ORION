import { HabitatPolicyError } from './habitat.mjs';
import { requireLoopbackApiUrl } from './agent-hub-bridge.mjs';

const CAPABILITIES = Object.freeze({ canStart: false, canCancel: false, canObserve: true, canResume: false });

/**
 * Restricted F3c registration client: no ability to claim work or launch a CLI.
 * A reported session is NOT proof that a model or executable is running.
 */
export function createRuntimeRegistryClient({ apiUrl, token, fetchImpl = fetch }) {
  const origin = requireLoopbackApiUrl(apiUrl);
  if (typeof token !== 'string' || !token.startsWith('orion_agt_')) throw new HabitatPolicyError('invalid_token');

  async function request(route, body, expectedSessionId) {
    const response = await fetchImpl(origin + '/ai/v1/agent-hub/' + route, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new HabitatPolicyError('runtime_registry_http_' + response.status);
    const result = await response.json();
    if (!result || result.id !== expectedSessionId || typeof result.id !== 'string' || !Number.isInteger(result.revision) || result.revision < 0 ||
      !['recent', 'stale', 'closed'].includes(result.presence)) {
      throw new HabitatPolicyError('invalid_runtime_registry_response');
    }
    return result;
  }

  return {
    register(sessionId) {
      if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) throw new HabitatPolicyError('invalid_session_id');
      return request('runtime-sessions', { sessionId, kind: 'habitat_observer', capabilities: CAPABILITIES }, sessionId);
    },
    pulse(sessionId, expectedRevision) {
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HabitatPolicyError('invalid_revision');
      return request('runtime-sessions/' + encodeURIComponent(sessionId) + '/pulse', { expectedRevision }, sessionId);
    },
    close(sessionId, expectedRevision) {
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HabitatPolicyError('invalid_revision');
      return request('runtime-sessions/' + encodeURIComponent(sessionId) + '/close', { expectedRevision }, sessionId);
    }
  };
}

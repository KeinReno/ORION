# KAIDEN Habitat Supervisor — F3 observation mode

**Status:** prototype, explicitly started by a local operator. No Windows Service installer, no auto-start, no background autonomous dispatch.

The supervisor is a long-running **read-only observer**. It polls the existing Agent Hub F2 `orion_agent_hub_queue` HTTP endpoint on the loopback interface and records a local observation state. It does NOT claim tasks, run CLI programs, verify evidence or declare a model online.

## Local configuration

Add this field to the local `habitat.json` config (keep the file out of Git):

```json
{
  "version": 1,
  "enabled": false,
  "workspaceRoot": "C:\\work\\ORION",
  "profiles": [],
  "supervisor": { "enabled": false, "pollMs": 30000 }
}
```

To start observing, the human operator must **explicitly** set both `enabled` values to true and pass `--acknowledge-monitoring`. Unlike a process-launch profile, this opt-in grants read-only queue polling; the Agent Hub token still needs `tasks:read`, `agent-hub.execution.read`, and any project fence must be satisfied.

```powershell
node packages/habitat/src/cli.mjs supervise --config C:\private\habitat.json --token-file C:\private\orion-agent-token.txt --acknowledge-monitoring
node packages/habitat/src/cli.mjs supervisor-status --config C:\private\habitat.json
```

Press **Ctrl+C** to stop. The `SIGINT/SIGTERM` handlers persist `status=stopped` and release the instance lock when the event loop is still alive. Force-termination or power loss can leave a stale `supervisor.lock`; before manually deleting it, verify the recorded PID is no longer running. A second instance fails closed on the lock and never steals it.

The local file `.orion/habitat/supervisor.json` contains a session UUID, PID, mode, timestamps, last successful queue count, and a diagnostic `previousSession.interrupted` flag when the former run did not exit cleanly. **No task bodies, transcript content or bearer tokens are persisted.** State updates use a unique temporary file and an atomic rename. `freshObservation` only describes the age of the observation, not process existence or agent availability.

## Explicit limitations

- There is no durable server-side runtime registration, secure process attestation or remote heartbeat in this PR. The session UUID is **local diagnostic data**, not an ORION Agent Registry identity.
- The supervisor does not automatically reclaim expired Agent Hub leases: F2 currently requires an explicit owner/lead reconciliation.
- The supervisor does not spawn a CLI, run OS commands or wake a subscription IDE. F3 `run-hub` remains a **separate operator-initiated command**.
- It is not a Windows Service. It runs only as long as the manually launched Node process remains alive; it will not start after Windows login or a reboot.
- Filesystem access control is inherited from the operator account; use private NTFS ACLs for config and token files on Windows.
- The server may reject `GET /ai/v1/agent-hub/executions` if the token or module is disabled. On 401/403 polling stops; on temporary errors the local state becomes `offline` without claiming execution has completed.
- Node unit tests in this stage cover the standalone supervisor using stubbed F3 module imports and mocked F2 responses; an actual migrated ORION API and Windows desktop smoke still need verification.

## Next integration milestone

Implement a server-side, versioned, authenticated Agent Runtime Registry in the Agent Hub module with session binding, capabilities, explicit owner approvals, signed nonce/replay protection, TTL expiry, and device identity. Separate monitoring rights from worker rights and normal write budgets. Then add a Windows Job Object-powered runner and user-controlled service installer; only after these gates consider unattended task claiming.

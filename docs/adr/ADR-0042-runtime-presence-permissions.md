# ADR-0042 — separate runtime presence permission from task execution (PROPOSED)

**Date:** 2026-10-29  
**Status:** staged draft, stacked on F3c.

## Security issue

The original generated Agent Hub module tools shared one primary resource: `agent-hub.execution.create`. This permission authorized **both** manual task claim/report and the new runtime observer registration. A token intended only to report presence could therefore also claim a user Task. That violates least privilege and blocks unattended deployment.

## Decision

Extend the generic optional-module manifest contract with:

```json
{
  "permissions": {
    "primaryResource": "execution",
    "additionalResources": [{"resource":"runtime","actions":["create"]}]
  }
}
```

Individual generated module tools may declare `resource:"runtime"` only when the resource/action is explicitly declared. The generator validates uniqueness and legal actions, emits `GENERATED_ADDITIONAL_PERMISSIONS`, and uses the declared per-tool resource to derive permissions. The shared platform permission registry imports that generated collection without hardcoding Agent Hub into Core.

Runtime register/pulse/close now require `agent-hub.runtime.create`. Manual worker claim/report continue requiring `agent-hub.execution.create`. Both need a valid AgentTokenGuard token and AgentModuleToolsService authorization; runtime operations do not receive any process-launch capability.

A dedicated observer token needs `tasks:read`, `agent-hub.execution.read` (for the queue) and `agent-hub.runtime.create`, **not** `agent-hub.execution.create`. A normal assistant token with the observer permission cannot claim user tasks; the server should reject it with 403 before inspecting an execution.

## Handshake implementation

An optional local supervisor flag enables the loopback-only client to register its session UUID, periodically pulse on server CAS revision, and close on graceful stop. Registrations never grant execution rights and are excluded from workspace backups. The local observer continues to require a manual operator start and a separate `--acknowledge-monitoring` flag.

## Remaining risks and gates

No OS attestation, device enrollment, hardware-bound identity, Windows process isolation, automatic task dispatch, verified artifacts, or full end-to-end migration acceptance. Heartbeats consume token write budget; add dedicated liveness budget before scale. Run `pnpm module-registry --check`, `pnpm module-docs:check`, `pnpm typecheck`, `pnpm test:integration`, `pnpm architecture-check`, and Windows smoke before merging. Earlier stacked PRs remain draft.

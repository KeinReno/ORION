# Agent Hub — module passport (foundation branch)

**State:** NOT REGISTERED / NOT ENABLED. The code in this directory is an initial,
framework-free lifecycle policy, not a running orchestrator.

**Owner:** optional Agent Hub module (domain coordination). It is not Core and
must not directly import concrete Tasks, Projects, Chat Archive or IDE internals.

## Scope

- Owns execution attempts, task dispatch, agent-to-agent handoff, evidence,
  heartbeat leases, checkpoints and review lifecycle.
- References existing user Tasks and existing AgentJob records by typed IDs.
  It MUST NOT introduce a second source of truth for user task content.
- Existing AI Bridge remains owner of token authentication, scopes, rate limits,
  audit and the current agents:message / agents:delegate APIs.
- An authorized Agent Runtime Adapter implements start/cancel/observe/resume.
  MCP alone is manual integration and is NOT proof of background execution.
- Windows Habitat and local runtimes are adapters, never imported by Core.

## Foundation files

- agent-hub-lifecycle.ts — pure, deterministic execution transition policy.
- agent-hub-lifecycle.test.ts — revision, lease, checkpoint, review and terminal guards.
- packages/shared-types/src/agent-hub.ts — public serialized contract.

## Next integration wave (NOT implemented by this branch)

1. Add manifest, API module, migrations and database RLS scoped to workspace.
2. Atomic CAS + journal for each execution revision; idempotency on commands.
3. Reconcile expired leases; durable checkpoint references and retries as new runs.
4. Module Bridge to task/job owners through their public contracts.
5. Human read-only board and approvals, then auditable runtime adapters.
6. Include durable execution state in .orion snapshots and test restore.
7. Manual MCP flow first; CLI launch only after documented provider capability checks.

No CLI auto-start, background daemon, browser automation, privileged shell access,
agent UI or external ChatGPT connection exists in this foundation.

## Disable and security policy

Disabling the future module MUST stop dispatch, cancel or quarantine live leases
safely, preserve records and remove exposed tools/panels. No runtime gets an
administrator token by default. Receipt references do not by themselves verify
artifacts: trusted verification belongs to the server adapter with independent
evidence checks. Coordinator-only commands are NEVER exposed as arbitrary agent input.

See docs/adr/ADR-0036-agent-hub-execution-foundation.md.

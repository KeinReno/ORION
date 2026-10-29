# ADR-0036 — Agent Hub execution foundation (PROPOSED)

**Date:** 2026-10-29
**Status:** Proposed; initial contract and pure transition policy in feature branch.
**Governance:** docs/PLATFORM.md, ORION_CONSTITUTION.md, docs/AGENT_HUB_ARCHITECTURE.md.
**Scope:** only Agent Hub foundation. No modification of existing AI Bridge behavior.

## Decision

Agent Hub is an optional, separately activatable domain module over existing
Core identity, permissions, durable events and Agent Gateway. KAIDEN Agent Core
is a portable protocol/state contract, not another workspace/task database.
KAIDEN Habitat and provider clients are runtime adapters outside the domain.

Keep three identities distinct:
1. Persistent logical agent/persona identifier (never an access credential).
2. Runtime/session identifier, with declared and detected capabilities.
3. Underlying model/version/provider, attributed per attempt.

A workspace Task or current agent-to-agent AgentJob is the business request.
An Agent Hub Execution is a separate attempt with a reference to that request.
No duplicate task descriptions or duplicate user-facing statuses.

## Versioned lifecycle v0

queued -> claimed -> working -> review -> done
claimed/working -> failed
working -> blocked -> queued
claimed/working (expired lease) -> queued
any nonterminal -> canceled

All commands supply expectedRevision for optimistic concurrency control.
A claim carries a bounded expiring lease. Only the owning worker can report
progress while its lease is live. A checkpoint survives lease expiry. A final
successful execution must carry artifact references and pass an independent
server-authorized review. Terminal runs cannot be modified; retries create
distinct executions. Persist transitions and audit in one transaction.

The pure helper is only a policy for adapters. It is NOT a dispatcher,
synchronization primitive, authorization mechanism or durable store.

## Threat model and capability gates

- An agent's task body, message or retrieved prompt is untrusted data.
- No rights inherit from the delegating agent. Never launch as admin by default.
- An MCP client may observe and write but cannot automatically be spawned.
- A manual client gets capability kind manual_mcp with canStart=false.
- A CLI adapter must explicitly detect/authorize start, cancellation, status
  observation and optional resume; do not imply Cursor is equivalent to Codex CLI.
- Coordinator-only verify/expire/requeue/cancel require server policy and audit.
- Lease timers are authoritative on the server; client timestamps are never
  sufficient to grant or extend rights.
- Receipt references must be resolved and checked against actual tests/files
  and execution provenance before setting done.
- No automatic access to personal conversation transcripts or machine-wide shell.

## Persistence and future public extension point

Agent Hub owns its execution and verification records and retains them when
disabled. The host will register an optional module and typed UI contribution
instead of changing the Settings shell directly. Agent Jobs and Tasks expose
public integration-reader/command contracts through a Module Bridge.
RLS, snapshot inclusion, migration/rollback, retry idempotency, dispatch
scheduler, human approvals, UI and runtime launch are separate acceptance gates.

NEW_EXTENSION_POINT_REQUIRED if a registered slot or public bridge is missing:
create an Extension Proposal rather than importing another module's internals.

## First acceptance sequence

1. Pure transition tests (claim races, expired heartbeat, checkpoint retained,
   replay/stale CAS, independent review, terminal immutability).
2. Database integration: two claimants, one winner; commit/journal atomicity.
3. Restart: requeue a timed-out run without losing its checkpoint.
4. Adapter: one authorized CLI worker claims, executes and reports evidence.
5. Human UI: live status is heartbeat-based, not a list of valid tokens.
6. Restore: .orion snapshot round-trip preserves the job and its provenance.
7. In a manual-MCP-only environment, dispatch correctly reports unsupported
   instead of silently pretending to start an IDE.

Current branch delivers item 1 code and test source only; tests still require
a full repository install/CI run. It does not claim items 2-7 completed.

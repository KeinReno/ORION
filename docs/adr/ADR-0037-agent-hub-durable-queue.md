# ADR-0037 — Agent Hub durable queue (PROPOSED)

**Date:** 2026-10-29
**State:** Draft implementation in `feature/agent-hub-f1-storage-20261029`, not yet tested on an installed ORION.
**Base:** ADR-0036; governed by `docs/PLATFORM.md`, `ORION_CONSTITUTION.md`, `docs/AGENT_HUB_ARCHITECTURE.md`.

## Decision: register a real optional module, without premature automation

The first working slice of Agent Hub is a manifest-registered `modules-ext/agent-hub` module. It uses the existing module generator, public TaskIntegrationReader, workspace permissions and RLS rather than editing the Tasks service or the AI Bridge.

- `AgentHubExecution` owns the durable state of a run.
- `AgentHubEvent` owns its append-only revision journal.
- The `targetKind/taskId` reference is **not** a copy of a Task.
- For this slice, a human owner/lead can create a queued run for an existing Tasks record and cancel a nonterminal run using `expectedRevision`.
- Agent-to-agent Jobs do not yet get a run from the human API: a public AgentJob reader/command bridge must be specified first.
- No CLI auto-start, scheduled poller, token delegation or trusted runtime management is exposed.

## Data invariants

1. Every record has `workspaceId`, a workspace-membership RLS policy with ENABLE + FORCE, and RLS-scoped service calls.
2. Writes check owner/lead membership. Reads check membership. `@RequireModule("agent-hub")` and registered permissions gate the HTTP routes.
3. A partial unique index on (workspaceId, targetKind, targetId) forbids two **nonterminal** executions for one target, while allowing later independent retries.
4. Updates must CAS on `revision` and append a unique (executionId, revision) event **inside the same transaction**.
5. Creation supports client request UUID as an idempotency key (sequential replay). Competing creates for the same target return conflict; no silent overwrite.
6. `.orion` snapshot includes both execution and event rows, parent before child. The records remain when the module is disabled.
7. Until a trusted coordinator exists, no agent-accessible transition endpoint is exported; client-authored claim/verify/expire events would be unsafe.

## Known limitations

- This slice exposes no authenticated runtime claim/heartbeat service; `queued` represents a stored request, **not** evidence of an available worker.
- The panel is read-only. Task creation via the human API requires an existing task id; no new task is invented automatically from a conversation.
- Storage includes only task-targeted executions; agent-to-agent Job integration follows via an explicit public bridge.
- `defaultEnabled=true` reflects the platform's current enabled-module storage semantics: an unlisted module is active until explicitly disabled. This module starts **no background processes**, and it can be disabled by an owner.
- Multi-node coordination, notification events and cancellation propagation are outside this slice.
- Test source is present, but actual Prisma migration, runtime schema generation, integration tests, typecheck and Windows desktop acceptance have **not** been run through the GitHub connector.

## Required validation before merge

`pnpm module-registry --check`, `pnpm module-docs:check`,
`pnpm db:generate`, `pnpm typecheck`, `pnpm lint`,
`pnpm test`, `pnpm test:integration`, `pnpm architecture-check`,
`pnpm plugin-contract-check`.

Manual acceptance: migrate existing DB, create a task/run, replay requestId, try two concurrent creates, cancel with stale revision, disable/re-enable, verify journal, backup and restore data, exercise owner/lead/member isolation, then Windows packaged smoke test. Resolve all failures before merging.

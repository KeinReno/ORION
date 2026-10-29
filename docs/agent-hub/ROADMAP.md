# KAIDEN Agent Hub — implementation roadmap

**Status:** engineering work started 2026-10-29, base `master` @ `68a2384a86467f09af00da6311f934cd738f1d0d`.
**Current branch:** `feature/agent-hub-foundation-20261029`.
**Governance:** `docs/PLATFORM.md`, `ORION_CONSTITUTION.md`, `docs/AGENT_HUB_ARCHITECTURE.md`, ADR-0036.
**Release rule:** do not describe a design/contract as deployed functionality.

## Deliverable sequence

### F0 — portable lifecycle contract (foundation branch)

- [x] Separate task/job identity from execution-attempt identity.
- [x] Define runtime capabilities (manual MCP vs explicitly executable CLI).
- [x] Add deterministic lifecycle policy: claim, work, heartbeat, checkpoint,
      block, requeue, submit, review, fail, cancel and expired lease.
- [x] Add unit tests covering stale revision, competing claim, leases,
      independent review, checkpoint retention and terminal states.
- [ ] Execute full-repository typecheck/unit/architecture checks on a checked-out
      dependency-complete environment (not available in this connector session).
- [ ] Merge only after review/CI.

### F1 — registered optional module and durable execution

**Current slice (draft):** manifested module + RLS schema + snapshot registration, owner/lead create/cancel/read API, read-only board, integration test source. NOT yet validated against the running database or IDE. See ADR-0037.

- [x] Generate a fully valid `module.manifest.json` using `pnpm create:module`;
      do not create an orphan `modules-ext` directory.
- [x] Schema and migration for execution attempts, event journal,
      checkpoint references and evidence, with workspace RLS (runtime registration deferred).
- [ ] Persist transitions with CAS and atomic audit append; idempotency keys for
      command delivery, unique active claim and replay protection.
- [ ] Expose minimal human read endpoint and scope-protected agent endpoints;
      distinguish an execution run from the existing user Task and AgentJob.
- [ ] Public Task/AgentJob Module Bridge, no imports of another module's internals.
- [ ] Include durable agent-to-agent messages/jobs in backup and verify actual snapshot restore.
- [x] Register new execution/event models for snapshot inclusion (restore untested).
- [x] Disable/re-enable denies human HTTP access without deleting data (integration test written, not run).
- [ ] Safely handle in-flight work during disable (requires F2 scheduler).

**Acceptance:** two simultaneous claimants -> one claim; kill/restart -> recover;
restored snapshot -> exact task/provenance, no duplicate work; disabled module
-> no runnable endpoints, no data deletion.

### F2 — coordinator and local Habitat

- [ ] Install-time opt-in runtime service, independent of opening the UI.
- [ ] Queue monitor, lease renewal, expired-lease reconciler, finite retry policy
      and dead-letter diagnostics. A failure never implies completion.
- [ ] Runtime inventory: separate `online` heartbeat from valid token presence.
- [ ] Device-bound tools: allowed working directories, worktree lock, Git diff,
      tests, status and artifact receipts. Shell access only per explicit policy.
- [ ] Cancel and pause controls, approval gates, safe exit and recovery after
      power loss.
- [ ] No launch if user policy, provider capability or subscription rules forbid it.

**Acceptance:** close a human UI but leave opted-in host running -> permitted
work continues; terminate host -> no fake online status; restart -> recover.

### F3 — runtime adapters and interagent work

- [ ] Manual-MCP adapter first: visible `manual, awaiting worker`, never
      suggest that ORION can wake an IDE from a message alone.
- [ ] Official Claude Code CLI adapter after verifying supported launch and auth.
- [ ] Official Codex CLI adapter after verifying launch and subscription terms.
- [ ] Cursor capability adapter: read/write context and observe callbacks only
      where official interfaces actually support them.
- [ ] Agent-to-agent dispatch with atomic claim, handoff, artifact lineage,
      independent scope checks, and worker/reviewer separation.

**Acceptance:** two different supported runtimes exchange a task and receipts;
one may exit mid-work; no token privileges are inherited from the delegator.

### F4 — conversation-to-task and human UX

- [ ] Capture meaningful user directives/accepted decisions from supported
      hooks/integrations, with consent and sensitivity controls; not every message.
- [ ] Identify `task | note | decision | question | no-save` with provenance and
      model confidence; ask for clarification when a consequential intent is unclear.
- [ ] Connect conversation intent -> existing Task -> execution attempts ->
      evidence -> verified status in one coherent UI.
- [ ] Agent Hub dashboard using registered module UI slots: roster, queue,
      leases, blocked work, approvals, messages and receipts.
- [ ] Android view and scoped notifications, preserving desktop parity.

**Acceptance:** user assigns a concrete IDE task; ORION saves it once,
correctly shows running/blocked/completed states and an inspectable proof.

### F5 — continuity, independent Core and RINA Lab

- [ ] Portable versioned state bundle (identity vs model/runtime vs workspace
      permissions), with provenance, checkpoints and evidence; no secret export.
- [ ] Encrypted local, alternate-media and remote backup; tested full restore.
- [ ] Provider-neutral model routing that does not impersonate the prior model.
- [ ] Optional local low-capability fallback; unavailable models degrade
      gracefully to information-preserving mode.
- [ ] RINA Lab as a scoped experimental implementation; retain RINA-001/002
      as hypotheses, not consciousness claims.
- [ ] Controlled provider-swap / restore survival experiments with measurable
      behavioral continuity and explicit attribution.

## Non-negotiable security / test matrix

- Workspace isolation, RLS, token revocation and audit on every service boundary.
- Untrusted agent messages/remote transcripts never become executable instructions.
- Avoid broad administrator mode for default or unattended runtimes.
- Only verified artifacts may satisfy a completion policy.
- Concurrent claims, out-of-order events, expired leases, replay, time shifts,
  missing runtime, disabled module, cancelled work and backup restore are tested.
- GitHub is for code and non-sensitive references, never raw private transcripts.
- Do not imply ChatGPT subscription grants API inference or automatic access to
  localhost; integrations require actual platform support and user authorization.

## Current verified/unverified boundaries

The existing ORION AI Bridge already has scoped tokens, jobs/messages, MCP and
an audit trail. This branch adds only a portable, pure lifecycle policy and
associated tests/source documentation. No module manifest, scheduler, database
table, worker launch, UI, backup integration or autonomous execution has been
implemented yet. No CI or local build was run during the GitHub-connector change.

## F1 implementation status — 29 October 2026

- **Code written in feature branch:** module manifest, owner/lead human API, service, DB models/migration, generated registry targets, read-only panel, unit/integration test source.
- **No claim of runtime acceptance:** GitHub connector cannot execute the repository's toolchain; no pnpm, Prisma migration, RLS integration tests, Windows launch or APK test was run. Keep PR draft.
- **Next blocker:** local CI-equivalent check and database migration verification before adding autonomous runtime endpoints. No secrets or real user data were modified.

## F2 — manual MCP worker bridge (draft, 29 October 2026)

- [x] Module manifest declares scoped MCP tools: `orion_agent_hub_queue`, `orion_agent_hub_claim`, `orion_agent_hub_report`.
- [x] AgentTokenGuard and AgentModuleToolsService enforce permissions, mode and write budget.
- [x] Task read scope and per-project fence are checked before disclosing or claiming a target.
- [x] Server derives worker ID from token; command timestamps and lease length are server-issued.
- [x] Durable CAS state transition and same-transaction audit event for all worker changes.
- [x] Owner/lead-triggered reclaim of timed-out leases, with checkpoint retained.
- [x] Integration test source: second worker denial, scope/project fences, successful claim→checkpoint→review, expiry/recovery.
- [ ] Run all checks against generated Prisma client and migrated local DB; fixes required before merge.
- [ ] Add runtime session attestation, auto lease reconciler and device-aware worker scheduling.
- [ ] Verify actual artifact content before granting a final 'done' state; no agent-controlled verify endpoint.
- [ ] Add end-to-end Windows MCP smoke including token revocation and module disabling.

**Important:** F2 is a manually invoked MCP protocol, **not** a remotely wakeable Cursor/Claude/Codex process. A model must actually call the tools. No background agent has been launched or tested.


## F3 — KAIDEN Habitat local operator integration (draft)

- [x] Standalone Node 20+ runtime package with explicitly locally approved profiles, filesystem canonicalization, no-shell spawn, timeout/abort and hash-only receipts.
- [x] run-hub loopback-only operator bridge to the F2 queue: claim, start, periodic heartbeat, submit for review on successful exit; fail on failed process.
- [x] Agent token stays in a local file/HTTP header and is never forwarded to the spawned CLI.
- [x] Heartbeat authorization failure aborts the local runner; no evidence is submitted after a revoked/invalid lease.
- [x] Standalone Linux Node checks: 12 passing tests, 0 failing; mocked F2 API for the loopback bridge.
- [ ] Windows Job Object supervision and restricted OS identity.
- [ ] End-to-end F0–F3 run against a migrated ORION instance, including token revocation, write-budget behavior and restored checkpoints.
- [ ] Provider-specific, officially supported CLI adapters and license/auth verification.
- [ ] Independent verification of local evidence before a server-side done transition.
- [ ] Workspace-scoped permissioned installation, default-off service/UX, and explicit rollback.

This is NOT autonomous execution. The owner must initiate each local run and approve the profile.

## F3c — reported runtime session registry (draft, 29 October 2026)

- [x] Dedicated `AgentHubRuntimeSession` model with forced workspace RLS, TTL, token ID, scoped declared capabilities, optimistic revision and closed state.
- [x] Agent-token-scoped register/pulse/close endpoints through AgentModuleToolsService; human read-only inventory.
- [x] v0 runtime capabilities hard-locked to observer-only; a registration cannot authorize CLI execution.
- [x] Presence computed as recent/stale/closed, not an authenticated running process. Runtime session is ephemeral-excluded from backups.
- [x] Integration test source for replay, cross-token denial, invalid capabilities, stale sessions and CAS.
- [ ] Full Prisma generation, DB migration, module-registry checks and integration tests (not run in connector).
- [ ] Wire local supervisor's session lifecycle to register/pulse/close after server-side API validation.
- [ ] Add tamper-resistant runtime attestation and restricted Windows process execution before unattended claims.

## F3d — dedicated observation permission and local registry handshake (draft)

- [x] Extend optional module manifest generator with declared additional permission resources and per-tool resource selection.
- [x] Register `agent-hub.runtime.create` independently of `agent-hub.execution.create` so monitoring tokens cannot claim queued work.
- [x] Add local loopback client and opt-in supervisor register/pulse/close handshake (never auto-executes a task).
- [ ] Run module-registry, module-docs, lint, typecheck, integration tests on migrated ORION.
- [ ] Complete explicit token revocation/presence invalidation and secure device attestation.

## F3e — native Windows Job Object containment (draft)

- [x] Native .NET 8 host source with CreateProcessW(CREATE_SUSPENDED), AssignProcessToJobObject, KILL_ON_JOB_CLOSE and inherited stdin/out/err streams.
- [x] On Windows, the Node profile runner refuses direct CLI execution unless an operator-approved `windowsHost` binary path exists.
- [x] Add simulated Win32-path tests for missing host and Job Object launch request construction.
- [ ] Compile on Windows and pass child + grandchild process-tree smoke tests, timeout, crash and command-line quoting cases.
- [ ] Add low-privilege Windows account, executable hash pinning/signature validation, and provider-specific profiles.
- [ ] Obtain reliable actual Windows acceptance before any unattended execution.

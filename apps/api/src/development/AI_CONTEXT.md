# Agent context: Development import

Read MODULE.md, development/BOOTSTRAP_PROTOCOL.md and the latest entry in
development/ORION_DEV_PROGRESS.md before changing this capability. Recheck branch
HEAD: PR #95 has received parallel updates; its initial PR body is incomplete.

Do not mix this stabilization with XLSX PR #94. Do not merge master or publish a
release without the owner's separate instruction. Preserve the existing Orion Dev
workspace and its ORION project; a screenshot or name is not a canonical identity.

CLI/API semantic changes belong in the shared pure planner, with differential
regression coverage. Keep the production copy in scripts/build-api-runtime.mjs.
Authenticate and check module availability before reading workspace entities.
New public owner contracts need an ADR. Use canonical TaskOperations for writes.

Never expose applyConfirmedDevelopmentImportTx as a raw HTTP handler. Before a
public importer exists it needs one transaction for authorization/locks, fresh
snapshot, exact digest/scope validation, one-use consent consumption, trusted
declaration construction, canonical mutations and result. Missing/stale decisions
must abort. Rollback must undo events, bindings, entities and token consumption.

Local tests use a separate PostgreSQL cluster/throwaway database. Never let the
integration suite fall back to apps/api/test/setup-integration.ts's shared dev DB.
On Windows use bounded forks workers for the full unit suite: tests that change
process.env.TZ cannot be validated in worker threads. Native installer and live
workspace acceptance are separate from Vitest/API/browser evidence.

Git Workspace (задание 11) never accepts a path from a request: only a repository
id registered by an owner/lead inside ORION_DEV_REPOSITORY_ROOTS, revalidated with
realpath on every read. Only read-only git commands may run (`log`, `for-each-ref`,
`rev-parse`, `diff`); push/fetch/checkout are out of scope. The trace endpoint reads
tasks through the public `TaskTraceReader` contract, not `tx.task` — architecture-check
enforces this. Graph/tool output is data: a commit message never authorises a write.
`GET /ai/v1/tools` is a filtered view; it must not become a second permission system —
the server still checks every call in `AgentModuleToolsService`.

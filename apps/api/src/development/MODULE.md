# Development import capability

This directory implements the fixed ORION DEV catalog preview and short-lived
consent and atomic apply API. It is not a second Task system. The registered
`orion-dev` additional Workbench module imports DevelopmentImportModule. Catalog
access uses the packaged API catalog or administrator-controlled
ORION_DEV_CATALOG_ROOT. No user-supplied path is read.

Ownership: DevelopmentCatalogMapping and DevelopmentImportConsent belong to
development; Project, Task and TaskDependency remain with their original owners.
See [ADR-0044](../../../../docs/adr/ADR-0044-development-import-stabilization.md).

HTTP: authenticated GET preview, POST consent and POST apply under
workspaces/:workspaceId/development-import. Owner/lead only; Projects and Tasks
and ORION DEV must be enabled. The returned preview/consent never skips fresh
authorization at write time. Consent creation writes only a hashed consent record.
Apply rereads the locked state, validates the digest and exact choices, consumes
consent and calls canonical import stages in one RLS transaction. Any error rolls
back every write, including token consumption and task events.

The CLI and API share packages/shared-types/development-plan.cjs. The CLI also
proposes workspace creation; the API requires one authenticated existing workspace.
Durable mappings have precedence over title hints; collisions fail closed.

Internal import stages run only in the caller's withUser transaction. Catalog
writes serialize by workspace and lock the role row. Dependency updates also lock
the canonical graph and use revision checks. Task writes require TaskOperations;
no direct Task/TaskDependency writes or imports of concrete neighboring services.
Only the reviewed controller composes these helpers into the consent-gated API.
Descriptions of new objects include phase and acceptance criteria. Existing
descriptions are preserved; repeat imports do not duplicate canonical objects.

Mappings are included in backups and remapped on workspace transfer. Consent is
ephemeral, excluded from restore/sync, and scoped to user/workspace/catalog/preview/
selection. Agent execution, acceptance and task completion remain separate.

Verification and remaining release gates:
[stabilization report](../../../../development/LOCAL_STABILIZATION_2026-11-02.md).

Review/apply contract and product decisions: [ADR-0045](../../../../docs/adr/ADR-0045-development-review-apply.md).

## Git Workspace, commit links, Architect (задание 11)

`DevelopmentGitRepository` is the only way a repository becomes readable: an owner/lead registers an
absolute path inside the allowed roots — explicit `ORION_DEV_REPOSITORY_ROOTS`, or the node user's
home directory when the variable is unset, so a local node needs no env setup. The path is resolved
with `realpath`, checked against every allowed root and confirmed to be a git work tree before it is
stored; `POST …/repositories/init` instead creates a git repository (`git init`, branch `main`) in an
empty or new folder inside the roots and registers it in one step. Every later read
revalidates the stored path, so removing a root from the environment closes access without deleting
the record. No request ever carries a path to `git`.

Reads are `git log`, `for-each-ref`, `rev-parse` and `diff` only — executed with `execFile`, no
shell. Graph history is capped (2,000 commits fetched, 500 per page by default) and cached in memory
per branch, invalidated by the `.git` signature (HEAD, index, packed-refs, refs, reflog mtimes). Branches,
tags, merges, author/branch/date filters and sha-cursor pagination are computed from that history;
`pullRequest` is `null` until an external provider exists.

`TaskCommitLink` binds a commit to a task. Automatic links come from the repository's configurable
`taskRefPrefix` (`#42` = the 42nd task of the workspace by creation order, or a uuid prefix), resolved
through the public `TaskTraceReader` contract — never by direct `Task` queries. Manual link/unlink
requires `tasks.task.update`. `GET tasks/:id/trace` joins creation, assignment/status journal, commits,
QA (contract placeholder) and release (placeholder) into one timeline.

`DevelopmentArchitectLayout` stores only user data: node positions, viewport and an uploaded project
schema (jsonb, revision like `GoalCanvasLayout`). The map itself is rebuilt by
`architect/architect-analyzer.ts` on every request (regex-level TS/Rust import graph, no AST
dependency), so code changes appear immediately and the layout only contributes coordinates.
`GET .../compare` diffs the uploaded schema against the analyzer and reports missing/extra
nodes and edges.

`AgentToolRunner` (in `mcp/`) exposes `orion_git_graph` and `orion_architect_map` through the existing
`AgentModuleToolsService` policy: module permission `orion-dev.development_import.read`, token mode,
module switch and an `AgentAuditEntry` for every call. `GET /ai/v1/tools` is the scope lease the MCP
adapter uses for `tools/list`; the adapter falls back to the static catalogue when the call fails.

Verification: `apps/api/test/development-workspace.integration.test.ts` (real `git` fixture, branches,
merge, pagination, compare, `#42`, manual link, trace, architect map/layout/compare, MCP tools and
audit); unit tests for the parsers, analyzer and tool selection.

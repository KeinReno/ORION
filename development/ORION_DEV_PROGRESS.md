# ORION DEV — progress journal

## 2026-11-01 — foundation

**Branch:** `feat/orion-dev-foundation`  
**PR:** #95 (draft)

### Implemented in source

- Versioned development portfolio catalog with projects, phases and work items.
- Bootstrap protocol specifying authorization, idempotency, evidence and release gates.
- Read-only import planner (`scripts/orion-dev-plan.mjs`) that validates dependencies and proposes workspace/project/task actions.
- Durable mapping *resolution* in planner using snapshot `mappings` records scoped to catalog, rejecting duplicate or stale bindings.
- Vitest cases for dry-run behavior, dependency cycles, ambiguous names, mapping resolution and stale mappings.

### 2026-11-01 — follow-up: workspace mapping isolation

- Inspected the existing Prisma schema: canonical Workspace, Project, Task, TaskDependency and AgentHubExecution models already exist.
- Hardened the dry-run planner so every durable mapping must explicitly belong to the resolved ORION DEV workspace; foreign/unscoped mappings fail closed rather than being reused.
- Added regression tests for foreign-workspace and missing-workspace mapping inputs; updated earlier mapping fixtures to include workspaceId.
- Commits: `5eb23b5`, `28ec1f0`. Tests committed but not executed in a local Orion checkout.

### 2026-11-01 — follow-up: fail-closed mapping conflicts

- Re-read the current catalog, bootstrap protocol, journal and Prisma schema before editing.
- Planner now rejects bindings for catalog project/task IDs that no longer exist instead of silently ignoring them.
- Planner now rejects conflicting name candidates when a durable mapping points to a different project/task; no silent reuse of an ambiguous entity.
- Added three regression tests for unknown task mappings and project/task mapping-name conflicts.
- Commits: `12e03f5`, `88f27eb`. Tests were **not executed** in a checkout.
- No schema migration or importer write endpoint was added; database mapping persistence remains the next implementation milestone.

### 2026-11-01 — mapping persistence schema (partial)

- Added Prisma `DevelopmentCatalogMapping` with workspace FK, catalog ID, kind, external ID and canonical entity ID.
- Added workspace relation and two unique constraints to prevent duplicate external keys or multiple external bindings to one canonical entity within a catalog/workspace/kind.
- Commit: `261c2ab`. **Schema only**: SQL migration, RLS policy, transactional importer and runtime tests are not implemented yet. Do not deploy this schema without reviewing migration and RLS behavior.


### 2026-11-01 — roadmap validation

- Re-read the catalog, bootstrap protocol, progress journal, Prisma schema and current planner.
- Added fail-closed validation of phase IDs, phase dependency references, phase dependency cycles, and project/task phase references before planning.
- Added regression tests for unknown phase references and cyclic phase dependencies.
- Commits: `b7ce2e8`, `3fe4c90`. Tests **not executed** in a repository checkout.
- Mapping model still lacks a reviewed SQL migration and RLS policy; no database writes or importer endpoint were added.

### Not yet verified

Tests have been committed but have **not** been run in the Orion checkout. No database migrations, authenticated import endpoint or user-facing import UI have been implemented. Mapping records are an input contract only; persistence is not implemented.

### Next action

Inspect existing migration conventions and RLS policy, generate and review the SQL migration for the new mapping model, then implement transactional mapping persistence scoped to workspace and catalog. Integrate with existing workspace/project/task services behind authenticated permissions; retain dry-run default. Do not automatically accept name matches.

### Guardrails

Do not merge to `master` or publish beta without approval. Agent completion is not independent acceptance. Report actual commits and test evidence only.

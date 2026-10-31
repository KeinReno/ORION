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

### Not yet verified

Tests have been committed but have **not** been run in the Orion checkout. No database migrations, authenticated import endpoint or user-facing import UI have been implemented. Mapping records are an input contract only; persistence is not implemented.

### Next action

Inspect existing migration conventions and RLS policy, then implement transactional mapping persistence scoped to workspace and catalog, with unique constraints. Integrate with existing workspace/project/task services behind authenticated permissions; retain dry-run default. Do not automatically accept name matches.

### Guardrails

Do not merge to `master` or publish beta without approval. Agent completion is not independent acceptance. Report actual commits and test evidence only.

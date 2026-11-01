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


### 2026-11-01 — mapping SQL migration (unverified)

- Inspected the Prisma mapping model, database role separation in `infra/postgres/init/01-app-roles.sql`, and the RLS transaction contract in `CLAUDE.md`.
- Added migration `20261101050000_development_catalog_mappings`: table, workspace foreign key, uniqueness constraints, kind check, index, FORCE RLS membership policies, and app/system grants.
- Commit: `fe86c322`. SQL **not executed** against PostgreSQL. RLS policy and membership privileges require integration testing before deployment. No authenticated importer endpoint or write service exists yet.
- Next: inspect the precise workspace-member role and RLS policy conventions, add a disposable PostgreSQL migration/RLS regression test (member vs outsider vs missing session), then implement an authorized transactional mapping writer. Do not claim production readiness.

### 2026-11-01 — mapping RLS integration regression (not executed)

- Verified PR #95 exists and re-read catalog, bootstrap protocol, progress journal, Prisma schema, migration SQL, app role grants and the existing API RLS integration suite.
- Extended `apps/api/test/api-rls.integration.test.ts` with a real-PostgreSQL regression scenario for member read/write, outsider invisibility, outsider INSERT denial, missing `withUser` session invisibility, and duplicate external mapping rejection.
- Commit: `57a01dc`. **Not executed**: this session has no migrated local PostgreSQL/Orion checkout; assertions are code coverage only, not evidence of passing RLS.
- Security follow-up: the new RLS policy currently grants INSERT/UPDATE to any workspace member. Before exposing the importer, enforce owner/admin authorization at the service layer and evaluate role-based policy hardening. Do not treat RLS membership as authorization to mutate the catalog.


### 2026-11-01 — workspace name-match authorization gate

- Re-read the current catalog, bootstrap protocol, progress journal, import planner, API RLS test suite and PostgreSQL role configuration.
- Corrected a protocol mismatch: an existing workspace with the name `ORION DEV` is now returned as `review_possible_match` (with `candidateId`), not `confirm_existing`. A name alone must not authorize importing into a user's existing workspace.
- Added a regression assertion for this gate.
- Commits: `7355d73`, `d83548f`. **Tests not executed** in this session. The change affects only the read-only planner; no write API or persistent workspace ownership mapping was added.
- Next: verify integration tests against a disposable PostgreSQL instance and design an explicit workspace ownership confirmation/mapping mechanism before enabling writes.

### 2026-11-01 — snapshot identity validation

- Re-read the versioned catalog, bootstrap protocol, planner, tests and progress journal.
- Planner now rejects malformed and duplicate workspace/project/task snapshot IDs before matching entities. This avoids ambiguous identity resolution from inconsistent snapshots.
- Added two regression tests covering duplicate IDs across all three entity types and missing/null IDs.
- Commits: `18782e9`, `4a5acbe`. **Tests not executed** in an Orion checkout. No DB migration was applied and no write importer was enabled.
- Next: run existing RLS integration tests on disposable PostgreSQL, inspect owner/admin permission conventions, and implement authorized transactional mapping writes only after verification.

### 2026-11-01 — project title-match confirmation gate

- Re-read the current catalog, bootstrap protocol, journal, dry-run planner and its tests.
- Fixed an unsafe planner classification: a project with the same title in the target workspace but without a durable catalog mapping was reported as `confirm_existing`. It now reports `review_possible_match` with its candidate ID, requiring explicit approval before a future writer may bind it.
- Strengthened the existing name-match regression test to assert the project-level confirmation gate.
- Commits: `5571312`, `b0c9b31`. Tests **not executed** in this session. This remains a read-only planning change, not a working confirmation API.
- Next: run targeted planner tests in a checkout, validate the PostgreSQL migration/RLS suite on a disposable instance, and implement an authenticated confirmation and transactional mapping writer.


### 2026-11-01 — duplicate task title ambiguity gate

- Re-read current catalog, bootstrap protocol, planner, tests, and journal; confirmed PR #95 remains discoverable.
- Fixed a dry-run ambiguity: multiple canonical tasks in the same matched project with equivalent normalized titles previously yielded `review_possible_match` with multiple candidate IDs. The planner now fails closed with `Ambiguous task` before proposing any binding.
- Added a regression test with two existing tasks whose titles normalize to the same catalog title.
- Commits: `7cb73e5`, `b7af997`. **Tests not executed**; this GitHub-only session has no checked-out runtime or database.
- Next: execute the planner Vitest suite in a local checkout, then verify migration/RLS on disposable PostgreSQL and implement authenticated transactional mapping persistence.

### 2026-11-01 — malformed catalog input hardening

- Re-read PR #95, catalog, bootstrap protocol, planner, tests and journal.
- Planner now rejects null project/task/phase rows and non-array phase/task dependencies with explicit validation errors, rather than uncaught property access or iteration errors.
- Added regression coverage for five malformed input cases.
- Commits: `f4b6a5e`, `ba760b4`. **Tests not executed**; no local checkout or PostgreSQL verification was performed.
- Next: run targeted Vitest tests and disposable PostgreSQL RLS integration suite; do not expose write importer until authorization and migration checks pass.

### 2026-11-01 — malformed mapping row validation

- Confirmed PR #95 remains open/draft and inspected current catalog, bootstrap protocol, progress journal, planner, tests and package scripts.
- Fixed an unhandled null/non-object mapping row: the planner now rejects it with a controlled `Invalid mapping` error before reading `catalogId`.
- Added regression coverage for null, undefined, string, number and array mapping rows.
- Commits: `5c4063b`, `5e1d5f4`. **Vitest not executed** in this GitHub-only session; no runtime or PostgreSQL verification is claimed.
- Next: execute targeted Vitest in a checkout and the RLS integration suite against disposable PostgreSQL; resolve failures before implementing the authenticated transactional importer.

### Not yet verified

Tests have been committed but have **not** been run in the Orion checkout. A SQL migration has been added but not executed; no authenticated import endpoint or user-facing import UI have been implemented. Mapping records are an input contract only; persistence is not implemented.

### Next action

Run `pnpm db:migrate` and `pnpm test:integration` on disposable PostgreSQL and resolve failures, then implement owner/admin-authorized transactional mapping persistence scoped to workspace and catalog. Integrate with existing workspace/project/task services behind authenticated permissions; retain dry-run default. Do not automatically accept name matches.

### Guardrails

Do not merge to `master` or publish beta without approval. Agent completion is not independent acceptance. Report actual commits and test evidence only.

### 2026-11-01 — catalog task title collision validation

- Re-read catalog, bootstrap protocol, planner, regression tests and current journal; PR #95 remains discoverable.
- Planner now rejects duplicate normalized task titles within the same catalog project, and rejects blank task titles, before generating a name-based import plan. Identical titles in different projects remain permitted.
- Added regression coverage for same-project collisions, blank titles and cross-project allowance.
- Commits: `1c9688a4`, `090a379c`. **Tests not executed** in this GitHub-only session; PostgreSQL/RLS remains unverified.
- Next: run targeted Vitest in a checkout and migration/RLS integration tests on disposable PostgreSQL; only then build the authorized transactional importer.


### 2026-11-01 — mapping write authorization hardening

- Reviewed the live branch's bootstrap protocol, catalog planner, mapping migration, workspace role checks and API RLS test.
- Added additive migration `20261101060000_development_catalog_write_roles`: only workspace `owner` and `lead` roles may INSERT/UPDATE development catalog mappings. Workspace members retain SELECT access. No DELETE policy.
- Added an API/PostgreSQL integration regression covering member SELECT allowed and INSERT/UPDATE denied.
- Commits: `a3f9cf0`, `b625ef0`. **Not executed** against PostgreSQL; SQL syntax, RLS role semantics and integration assertions remain unverified.
- Next: run disposable PostgreSQL migrations and integration tests, then implement owner/lead-authorized mapping persistence using existing `withUser` and role gates. Do not expose writes before tests pass.


### 2026-11-01 — catalog project-title ambiguity gate

- Re-read the versioned catalog, bootstrap protocol, planner, tests, migration and journal on `feat/orion-dev-foundation`.
- Planner now rejects blank project titles and duplicate normalized project titles (trimmed/case-folded) before constructing a dry-run. Unique external project IDs alone are insufficient to disambiguate name-based review.
- Added a Vitest regression covering both blank and equivalent duplicate project titles.
- Commits: `bcaa6518`, `aba7f6fe`. **Tests not executed**; PostgreSQL migration and RLS remain unverified.
- Next: run Vitest and PostgreSQL integration tests in an isolated checkout; then implement transactional owner/lead-authorized mapping persistence with explicit confirmation and idempotency.


### 2026-11-01 — explicit workspace selection for dry-run

- Re-read the branch catalog, bootstrap protocol, planner, tests, journal, and owner/lead RLS migration before editing.
- Added optional `snapshot.targetWorkspaceId` to select a known workspace when several workspaces share the name ORION DEV. Unknown or invalid IDs fail closed. Name matching alone still never authorizes writes: the workspace and project remain `review_possible_match`.
- Added Vitest regression for ambiguous names, explicit selection, review-only actions, unknown IDs and blank IDs.
- Commits: `ede064d`, `47b40c8`. **Tests not executed**; no local checkout, PostgreSQL migration or RLS test was run.
- Next: execute Vitest and disposable PostgreSQL integration tests, then implement authenticated confirmation and transactional mapping persistence. No write importer or UI exists yet.

### 2026-11-01 — local PostgreSQL verification

Checked out `feat/orion-dev-foundation` at `826ed14`. `master` was not changed, PR #94 was not merged, and no beta was published.

Commits:

- `0cd4b81476c45108f47b4b12dbed0bafb627aced` — catalog id checks run before phase fields are read.
- `c3eebaf46e5da4847c7358e09ce0c883b95b90d5` — `DevelopmentCatalogMapping` is included in backups and classified `strict` (no offline writes).
- `d0d10de315e18141a2115540c5edc60a5e3e052a` — workspace transfer rewrites `entityId`, or drops the mapping when the target is absent.

Commands and results, on this machine against Postgres `127.0.0.1:5433` database `orion`:

```text
pnpm db:up
pnpm --filter @orion/api prisma:migrate:deploy
```

`migrate deploy` applied seven pending migrations, including `20261101050000_development_catalog_mappings` and `20261101060000_development_catalog_write_roles`. The database was also behind `master` by five earlier migrations; those were applied in the same deploy.

```text
pnpm exec vitest run scripts/orion-dev-plan.test.mjs
```

Before the planner fix: 20 passed, 1 failed (`rejects null catalog rows...` expected `/Invalid or duplicate project ID/` and got `Cannot read properties of null (reading 'phase')`). After `0cd4b81`: 21 passed.

```text
pnpm exec vitest run scripts/orion-dev-plan.test.mjs apps/api/src/sync/sync-classification.test.ts
```

27 passed (21 planner + 6 sync classification) after the backup registration.

```text
pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/api-rls.integration.test.ts apps/api/test/snapshot.integration.test.ts -t "catalog mapping|explicitly classified|workspace-owned table"
```

4 passed, 29 skipped. The four are member/outsider/missing-session isolation, member write denial, RLS on every workspace-owned table, and snapshot classification of `DevelopmentCatalogMapping`.

The authenticated transactional importer is still not implemented. Name matches remain review-only. PR #94 stays a separate draft.

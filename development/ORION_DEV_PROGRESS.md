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


### 2026-11-01 — authenticated transactional mapping primitive

- Verified PR #95 HEAD after Grok's locally tested fixes (`f8b11ed`), catalog, protocol, Prisma mapping schema and existing API services.
- Added `apps/api/src/development/catalog-mappings.ts`: a transaction-scoped, owner/lead-only binding primitive; validates canonical project/task workspace ownership, returns existing identical mappings on retry and rejects conflicting external/target IDs. The unique database constraints remain the concurrency backstop.
- Added PostgreSQL integration regression for first binding, idempotent retry, conflicting binding, outsider rejection and missing target.
- Commits: `c4cf822`, `f4cccd9`. **New tests not executed** here; earlier Grok runs did not cover these changes.
- This is a service-level primitive, **not** a public API or a working importer. It does not create projects/tasks or grant consent. Caller must use `PrismaService.withUser` and an explicit confirmation gate. Next: execute integration test on Grok's local PostgreSQL, check TS typecheck, then integrate into a guarded importer with explicit confirmation and safe retry.


### 2026-11-01 — atomic canonical project import stage

- Inspected current PR HEAD, canonical Prisma Project/Task schemas, project/task services, catalog, protocol and mapping primitive.
- Added `apps/api/src/development/catalog-project-import.ts`: transaction-scoped project import for a *previously validated catalog and explicitly confirmed workspace*. Requires owner/lead, rejects duplicate catalog IDs/titles, never silently claims existing name matches, supports explicit existing-project confirmation, checks stale mappings and returns idempotent retry results. Project and mapping writes share one transaction; no manual fields are overwritten.
- Added PostgreSQL integration regression for creation, idempotent retry, conflict rollback and existing mapping confirmation.
- Commits: `75904e8`, `9cf8acc`. **Not executed:** new TypeScript checks, Vitest and PostgreSQL integration tests. Earlier local test evidence does not cover these commits.
- **Not a public endpoint or complete importer.** Task import, catalog validation wiring, explicit user-facing confirmation/dry-run, concurrency recovery, Agent Hub, UI and Qoder remain open. Caller must execute via `PrismaService.withUser` and enforce a confirmation gate; never invoke this primitive with untrusted client-provided project definitions.
- Next: add atomic task import with canonical dependency links, then wire a validated dry-run/confirmation service and guarded API. Batch local verification once a coherent feature slice is ready.


### 2026-11-01 — existing-project adoption regression

- Rechecked PR #95 HEAD, catalog, bootstrap protocol, project importer and integration suite.
- Added PostgreSQL integration coverage for refusing unconfirmed existing-project name matches, rejecting unauthorized adoption and stale confirmation, explicitly adopting a canonical project, preserving its manual description, and idempotent retry.
- Commit: `3e9de83`. **Not executed**: this new integration test and TypeScript typecheck. Prior Grok results do not cover it.
- Next: implement the canonical task-import stage with dependency handling, then batch-run API typecheck and integration tests in the local checkout. Keep the public import endpoint disabled until validated catalog and explicit confirmation gates exist.


### 2026-11-01 — canonical task import stage

- Rechecked draft PR #95 at `f527fe1`, versioned catalog, bootstrap protocol, project importer and integration suite.
- Added `apps/api/src/development/catalog-task-import.ts`: transaction-scoped canonical task creation and mapping for previously validated catalog input, using existing mapped projects; rejects missing/stale project mappings, ambiguous task titles, unconfirmed existing tasks, invalid IDs and duplicate catalog task titles. Owner/lead authorization and explicit existing-task confirmation are required. Exact mapping retries return `already_mapped`; existing task fields are never overwritten.
- Added integration regression for task creation, idempotent retry, explicit adoption, stale confirmation and preservation of manual description.
- Commits: `2ec3748`, `dc2984a`. **Not executed:** new TypeScript check and integration tests. No claim of runtime correctness.
- Deliberate limits: dependencies are not imported yet, and direct Prisma task creation in this internal primitive does not emit the normal task-domain event; integrate via canonical TasksService transaction method before any public exposure. No API endpoint, confirmation UI or full importer is enabled. Next: implement dependency linking and canonical task event handling, then guarded orchestration/confirmation flow; batch local verification later.


### 2026-11-01 — canonical task dependency linking

- Checked draft PR #95 at `1cd20cc`, catalog, bootstrap protocol, task import primitive, and canonical Prisma TaskDependency schema before editing.
- Added `apps/api/src/development/catalog-task-dependencies.ts`: owner/lead-only transaction primitive to add catalog dependency edges after all tasks are mapped. Verifies catalog declarations, mapped IDs, canonical task workspace ownership and cycles against **all existing workspace dependency edges**. Existing edges are retained; exact retries return `existing` without duplicate writes.
- Added PostgreSQL integration regression for edge creation, retry, cycle rejection and missing task mapping.
- Commits: `155a348`, `22f5a7f`. **Not executed:** TypeScript, Vitest, PostgreSQL integration tests; previous local verification predates these changes.
- This remains internal only. The guarded API, dry-run/confirmation flow, canonical task domain events, orchestrator, UI and Qoder integration are not complete. Concurrent dependency writers require further serialization/retry analysis.
- Next: connect the project/task/dependency stages to an authenticated, catalog-validated, explicitly confirmed orchestration service; batch local verification when the feature slice is ready. Never expose primitives directly as public endpoints.


### 2026-11-01 — atomic import-stage composition; Luna 6 acceptance plan

- Inspected live draft PR #95, versioned catalog, bootstrap protocol, task import and dependency implementation before changes.
- Added `apps/api/src/development/catalog-import-transaction.ts`: composes existing project, task and dependency primitives in one caller-owned `PrismaService.withUser` transaction. Rejects unconfirmed workspace and incomplete cross-stage declarations before any writes. Reuses canonical workspace-scoped mappings; stage failures roll back the transaction.
- Added PostgreSQL integration regression for combined create, idempotent retry and fail-closed declarations.
- Commits: `50d161d`, `a7131c6`. **Not executed:** TypeScript, Vitest, PostgreSQL integration tests. Earlier Grok evidence does not cover these commits.
- **Security boundary:** `workspaceConfirmed: true` is only an internal precondition, NOT authenticated proof of consent. Never pass untrusted request bodies into this function. No public API, trusted catalog equality verification, persisted confirmation token, concurrency lock, canonical task events, or UI yet. This module is not production-ready.
- Acceptance owner changed to Luna 6 per user. Consolidated acceptance should check migration state, TypeScript, all targeted Vitest, RLS, backup/restore, concurrent imports, stale mappings, events and rollback in a disposable database; document precise commands and SHA. Do not merge or release without explicit human approval.
- Next: implement server-controlled catalog snapshot/dry-run and one-time scoped confirmation binding before exposing the transactional composition through an authenticated endpoint. Then create a detailed Luna 6 acceptance handoff.


### 2026-11-01 — trusted catalog declaration validation

- Inspected current draft PR #95 at `2ba9957`, committed catalog, bootstrap protocol, transaction composer and task importer.
- Added `apps/api/src/development/catalog-trust.ts`: pure fail-closed validator for a full submitted import against a **server-owned** catalog. Requires exact catalog ID, project IDs/titles, task IDs/titles/project ownership and dependency sets; rejects missing/injected/duplicate declarations, unknown dependencies and cycles. Explicit existing-entity IDs remain optional and must be checked by the transactional importer.
- Added `apps/api/src/development/catalog-trust.test.ts` with positive, tampering, omission and cyclic-catalog cases.
- Commits: `8a2400a`, `ac03ef9`. **Tests and typecheck not executed** in this environment. The validator is not yet called by an authenticated API or a server-side catalog loader. Never treat it as a complete authorization or confirmation mechanism.
- Next: add trusted catalog loader, authenticated dry-run/confirmation binding, and invoke this validator before the composed transaction; avoid exposing internal import primitives directly. Luna 6 will own consolidated acceptance.


### 2026-11-01 — server-owned import declaration builder

- Rechecked live draft PR #95 HEAD `7af9a70`, catalog, bootstrap protocol, existing import composer and trusted catalog validator.
- Added `apps/api/src/development/catalog-import-builder.ts`: derives the complete project/task/dependency payload from a trusted catalog, accepting only workspace ID and explicitly reviewed existing-entity IDs as variable selections. Rejects unknown IDs, duplicate canonical target selections and invalid catalog graph through the existing trust validator.
- Added focused unit tests in `catalog-import-builder.test.ts` for exact payload generation, reviewed selections, rejected invalid selections and invalid dependencies.
- Commits: `b9be82b`, `d17ac35`. **Not executed:** TypeScript checks or Vitest. No claims of runtime verification.
- **Not production-ready:** this builder does not authenticate users, prove confirmation, load the catalog from a trusted server path or check candidate matches against a fresh snapshot. The `workspaceConfirmed` field is an internal stage precondition, not consent evidence. No API route exposed.
- Next: implement authenticated server-side catalog loading and dry-run snapshot, then a scoped expiring confirmation protocol; only afterward expose the transaction. Luna 6 will conduct independent acceptance.


### 2026-11-01 — workspace preview snapshot

- Inspected PR #95 at `4f8db3b`, catalog, protocol and dry-run planner snapshot schema.
- Added `apps/api/src/development/catalog-import-snapshot.ts`: scoped read-only snapshot of workspace, projects, tasks and mappings; owner/lead permission check; intended for use inside `PrismaService.withUser`.
- Added integration regression for project/task visibility and nonmember denial.
- Commits: `59d83aa`, `f928eea`. Tests and TypeScript checks **not executed**.
- Not an API endpoint. Next: trusted server catalog loader and authenticated dry-run endpoint; then user confirmation before any write. Luna 6 acceptance remains pending.


### 2026-11-01 — fixed-source catalog loader

- Checked draft PR #95 at `bc86c36`, the versioned catalog, bootstrap protocol, snapshot reader, API TypeScript settings and progress log.
- Added `apps/api/src/development/catalog-loader.ts`: reads the fixed repository-relative catalog path, rejects missing/malformed/unsupported version and duplicate phase IDs, and returns a SHA-256 digest of exact file bytes for future confirmation binding. The repository root must be server-controlled, not supplied by an HTTP client.
- Added `catalog-loader.test.ts`: stable digest, changed content, missing file, malformed JSON, unsupported version/ID and duplicate phase cases.
- Commits: `68b2032`, `91aa26c`. Tests and TypeScript checks **not executed**. This loader is not wired to an endpoint; deeper catalog validation is still delegated to the trust validator.
- Next: integrate trusted loader, scoped snapshot and dry-run planner behind authenticated read-only API. Confirmation and writes remain disabled. Luna 6 acceptance pending.


### 2026-11-01 — preview digest and protocol correction

- Rechecked draft PR #95 and corrected stale implementation status in `BOOTSTRAP_PROTOCOL.md` (`1a05e53`).
- Added `catalog-preview-digest.ts` and focused tests (`62ec2f0`, `20686dd`): SHA-256 fingerprint changes with authenticated user ID, workspace ID, catalog digest or workspace snapshot. Intended only as a comparison primitive for future stale-preview rejection.
- The digest is **not** a secure confirmation token and is not canonical across arbitrary object-key order; callers must supply a stable snapshot shape. A future endpoint must issue and verify server-side single-use expiring consent and re-read state before writes.
- Tests and TypeScript checks **not executed**. No API endpoint or public importer exposed; Luna 6 acceptance pending.


### 2026-11-01 — authenticated read-only preview route

- Rechecked draft PR #95 HEAD `5a0b2e9`, catalog, protocol, preview digest, snapshot, existing JWT guard and Nest app module.
- Added `GET /workspaces/:workspaceId/development-import/preview` guarded by JWT. Server configuration `ORION_DEV_CATALOG_ROOT` selects the fixed catalog root. Endpoint returns version/hash, authorized workspace snapshot and user/workspace/catalog-bound preview digest. No write routes, import execution or client-provided file paths.
- Registered `DevelopmentImportModule` in `AppModule`; added fail-closed controller unit tests for absent/invalid server catalog configuration.
- Commits: `8a29edf`, `34aa1ee`, `0e0dabe`, `174ff10`. Tests and TypeScript checks **not executed**; integration remains unverified.
- This endpoint exposes raw snapshot and catalog for a client-side dry-run; it does **not yet run the planner server-side**, validate the full catalog graph at read time or issue a secure one-time confirmation. Next: wire validated planner output, tighten snapshot consistency and implement server-held confirmation before any write API. Luna 6 acceptance pending.


### 2026-11-01 — server-side dry-run preview

- Inspected live PR #95 at `7811570`, catalog, bootstrap protocol, trusted validator, controller and existing CLI planner.
- Added `catalog-server-plan.ts`: read-only API-side planning against an authorized workspace snapshot, using trusted catalog declarations; detects name-match review candidates, already mapped entities, ambiguous names and stale/foreign mappings. It does not adopt name matches or write anything.
- Wired the plan into the existing JWT-protected preview response; added unit tests for create, review, mapping reuse and rejection cases.
- Commits: `58ed4c0`, `d1b2eca`, `86f0981`. TypeScript and tests **not executed**; behavior remains unverified.
- This is an API-side planner separate from the existing CLI `scripts/orion-dev-plan.mjs`; parity must be checked during Luna 6 acceptance. The endpoint still has no confirmation token or write operation. Next: authorization/consent token persistence, atomic stale-snapshot validation and transaction concurrency safety before import writes.


### 2026-11-01 — reject orphaned mappings in API dry-run

- Rechecked live draft PR #95 at `a0e4bc1`, current catalog, bootstrap protocol, API planner, snapshot reader, builder and progress journal.
- Fixed `catalog-server-plan.ts`: mappings to project/task external IDs removed from the trusted catalog now fail closed instead of being silently ignored. The CLI planner already rejected these; this reduces a safety discrepancy between the two planning paths.
- Added focused Vitest regression covering both unknown project and unknown task external mapping IDs.
- Commits: `4a2b5c1`, `a4b1b3b`. **Tests and TypeScript checks not executed** in this run. No import write endpoint, consent issuance or master changes.
- Next: run API Vitest and typecheck; verify full CLI/API planner parity and stale-preview handling before implementing confirmation/write routes.


### 2026-11-01 — preview match review guard

- Rechecked draft PR #95 HEAD `9ca32dc` and current server-side dry-run implementation.
- Added `catalog-preview-matches.ts`: compares explicit choices with every `review_possible_match` in the preview, keyed by entity kind and external ID. Missing, extra or stale choices are rejected.
- Added `catalog-preview-matches.test.ts` covering accepted selections and omitted/unknown/stale decisions.
- Commits: `efaec02`, `2572fdb`. **Tests and typecheck not executed**. This is an internal review guard, NOT user authentication, a one-time confirmation token, or protection against changes between preview and commit.
- Next: bind the reviewed decisions to an authenticated user, workspace and fresh snapshot; revalidate within the write transaction. Do not expose a public write route before that boundary is complete.


### 2026-11-01 — scoped preview fingerprint

- Inspected PR #95 HEAD `febad3c` and reviewed-preview guard.
- Added `catalog-preview-binding.ts`: deterministic SHA-256 fingerprint of authenticated-user ID (caller-supplied), workspace ID, trusted catalog digest (caller-supplied), normalized preview actions and reviewed choices. A changed preview, catalog, identity or selection changes the fingerprint.
- Added unit tests for determinism, invalidation and workspace mismatch. Commits: `be9d21e`, `51e2647`.
- **Not executed:** Vitest or TypeScript. Fingerprint is NOT a signed consent token and cannot by itself prevent replay, forgery or stale writes. The future server must issue and store expiring one-time confirmations and re-read/revalidate the snapshot in the same transaction as writes. No write API exposed.


### 2026-11-01 — snapshot isolation guard

- Rechecked draft PR #95 at `404dbc1`; another development pass had already added preview selection fingerprinting and orphaned mapping rejection.
- Hardened API-side dry-run planner to reject foreign-workspace project/task rows and duplicate canonical entity IDs rather than silently ignoring them. Added regression tests for both foreign row kinds and repeated project IDs.
- Commits: `ce43257`, `aa14422`. Tests and TypeScript checks **not executed**. No confirmation or write API added. Next: server-held one-time consent and atomic revalidation; Luna 6 acceptance pending.


### 2026-11-01 — deterministic preview digest

- Rechecked PR #95 HEAD `8c35260` and hardened `catalog-preview-digest.ts`: recursively canonicalize JSON object keys while retaining array order; reject cycles, undefined values, NaN and unsupported data rather than silently hashing an ambiguous representation.
- Added tests for reordered object keys, changed arrays, cyclic and unsupported values. Commits: `34c91dc`, `6a0632f`.
- Tests and TypeScript checks **not executed**. The digest remains only a comparison primitive, not authorization or one-time consent. Next: persisted one-time confirmations with transactional revalidation before any write endpoint. Luna 6 acceptance pending.


### 2026-11-01 — orphaned preview task guard

- Re-read catalog, bootstrap protocol, progress journal and server-side planner before changing code.
- Server-side dry-run now rejects a task whose non-null projectId is absent from the authorized workspace project snapshot, rather than producing a plan from an inconsistent partial snapshot.
- Added Vitest regression for orphaned project references and a valid parent control case.
- Commits: `b600efb`, `f801d8b`. **Tests and TypeScript checks not executed** in this GitHub-only pass; no runtime verification claimed.
- Next: run targeted API Vitest and TypeScript checks in a checkout, then review planner parity and confirmation replay/staleness safeguards before enabling any write route.
- No master changes, merge or beta publication.


### 2026-11-01 — durable consent schema foundation

- Rechecked PR #95 at `f801d8b` before edits. Added Prisma `DevelopmentImportConsent` model with actor/workspace/catalog revision/preview/selection binding, SHA-256 token hash, expiry and consumed timestamp; relations to existing workspace/user.
- Added migration `20261101190000_development_import_consents` with foreign keys, unique token hash, lookup index and forced PostgreSQL RLS. SELECT/INSERT/UPDATE require the matching authenticated user and owner/lead workspace membership; no DELETE policy. Commits: `2dc2cf8`, `feab040`, `c1099c8`, `66b8ab8`.
- **Not yet implemented:** token issuance/consumption code, one-time conditional update, expiry enforcement, transaction revalidation or write API. No migration or tests executed; schema/migration compatibility must be verified locally before deployment. Luna 6 acceptance pending.


### 2026-11-01 — single-use consent transaction primitives

- Rechecked live PR #95 at `05a4a3d` and the persisted consent schema/migration. Added `catalog-import-consent.ts`: server-generated 256-bit random hex bearer token, SHA-256-only storage, five-minute expiry and user/workspace/catalog/preview/selection scope binding.
- Added `consumeImportConsentTx`: a single conditional Prisma `updateMany` transitions `consumedAt: null` to spent only when token hash, exact scope and expiry match; count != 1 fails closed. Must execute inside the same `withUser` database transaction as fresh snapshot validation and import, so failures roll back token consumption.
- Added focused mocked transaction tests for issue, hashed storage, expiry, conditional consumption, replay failure and malformed input. Commits: `6bbae0a`, `bd87a87`.
- **Not executed:** tests, TypeScript checks or database migration. No public issue/consume/write endpoints are exposed yet. Next: add consent issuance endpoint only after binding explicit reviewed selections to the server-side plan, then atomic snapshot revalidation and write integration; Luna 6 acceptance pending.


### 2026-11-01 — unify consent token primitives

- Re-read current catalog, bootstrap protocol, journal, consent secret helper, transactional consent module and tests.
- Removed duplicate random-token generation and hashing logic from `catalog-import-consent.ts`; issuance and consumption now share the fail-closed 256-bit secret helper.
- Extended transactional consent tests for shared hash parity and malformed null token rejection.
- Commits: `fd237a0`, `117c636`. **Tests and TypeScript checks not executed** in this GitHub-only pass.
- Next: verify TypeScript/Vitest and PostgreSQL migration, then bind issuance to authenticated reviewed preview and enforce atomic fresh-snapshot checks before exposing write endpoints.
- No master changes, merge or beta publication.


### 2026-11-01 — fail-closed consent scope validation

- Re-read catalog, bootstrap protocol, progress journal and consent transaction source/tests.
- Extracted shared scope validation for both issuance and consumption. Rejects blank actor/workspace, incorrect catalog or malformed SHA-256 bindings and invalid timestamps before database operations.
- Added mocked transaction regression verifying invalid consumption scope never reaches updateMany.
- Commits: `25bbc51`, `1961827`. Tests and TypeScript checks NOT executed in this GitHub-only pass.
- Next: run targeted tests and Prisma/PostgreSQL migration checks; bind issuance to authenticated reviewed preview and atomic fresh-snapshot revalidation before enabling a write API.
- No master changes, merge or beta publication.

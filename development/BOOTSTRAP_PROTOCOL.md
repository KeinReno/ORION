# ORION DEV bootstrap protocol

## Scope

ORION DEV is a normal workspace. Projects and tasks remain canonical Orion entities. Development Orchestrator is a platform capability, not a second task database.

## Import procedure

1. Authenticate the user through the existing API and check workspace membership and permissions.
2. Read the versioned development catalog and validate unique IDs, project references and acyclic dependencies before making changes.
3. Generate a dry-run plan listing proposed creates, matches, ambiguities and unsupported fields.
4. Require explicit confirmation before the first write. Never overwrite a manually edited entity.
5. Resolve the ORION DEV workspace by durable mapping first. A matching name alone is insufficient to assume ownership; request confirmation if found.
6. Persist catalog external IDs to Orion entity IDs in a dedicated mapping record, scoped by workspace and catalog. Enforce uniqueness transactionally.
7. Create missing projects and tasks using existing services and authorization checks. On retry, use the mapping and re-read state. Do not rely on title matching for idempotency.
8. Record per-item outcomes and failures. Resume partial imports safely; do not silently drop tasks.
9. Keep dependency edges as explicit data, not only in descriptions, once supported by the canonical task model.

## Agent execution

Agents may read authorized tasks, request leases and submit checkpoints and evidence. Only a trusted coordinator may issue leases. A worker may not accept its own result. Task status, execution status and acceptance status are separate fields. No simulated progress percentages. All changes should reference the task external ID, repository, commit and CI run where available.

## Safety and release

Use feature branches and draft PRs. Do not merge to master or publish a beta without explicit approval. Never claim runtime verification from static inspection. The first importer must ship with tests for duplicate names, concurrent imports, stale mappings, permission failures, dependency cycles and partial retries.

## Current state

The catalog, dry-run planner, mapping persistence, internal project/task/dependency import primitives, transactional composition, trusted-catalog declaration validator, import builder, workspace preview snapshot and fixed-source catalog loader are committed in draft PR #95. These are internal components, not an authenticated end-to-end importer. The API endpoint, server-issued expiring confirmation, concurrency controls, canonical task events, orchestrator and dashboard remain unfinished. New tests and TypeScript checks have not been run in the current development environment; this protocol is not proof of working integration.

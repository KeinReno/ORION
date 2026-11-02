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

The catalog, shared CLI/API dry-run planner, mapping persistence, internal project/task/dependency import stages, trusted-catalog validator, preview snapshot and fixed-source loader exist. Authenticated preview and short-lived hashed consent issuance are implemented. The local stabilization adds canonical TaskOperations/events, serialized catalog writes, dependency graph locking and regression coverage on real PostgreSQL. Consent is excluded from backup/sync; mappings remain durable. See [local verification and release gates](LOCAL_STABILIZATION_2026-11-02.md) for exact results and source revision.

The local continuation adds authenticated POST apply and the registered ORION DEV Workbench panel. Fresh state/role/module revalidation, consent consumption, trusted declarations and writes are composed atomically. Preview fingerprints include project/task modification metadata and dependency edges. New descriptions preserve catalog phases and acceptance criteria; existing objects retain their fields. The fixed catalog is shipped inside the desktop API package. See ADR-0045 for the contract and review/recovery states. Native Windows install/review/import/reopen/restart/reimport and population of the owner's actual Orion Dev workspace are now verified locally: see LOCAL_BETA_2026-11-02.md. Orchestrator/dispatcher/dashboard and independent task acceptance remain later stages; internal helpers must never bypass the reviewed public flow.

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

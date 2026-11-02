# Development import capability

This directory implements the fixed ORION DEV catalog preview and short-lived
consent API. It is not a second Task system or a finished user-installable module.
The application registers DevelopmentImportModule; catalog access is opt-in via
the administrator-controlled ORION_DEV_CATALOG_ROOT. No user-supplied path is read.

Ownership: DevelopmentCatalogMapping and DevelopmentImportConsent belong to
development; Project, Task and TaskDependency remain with their original owners.
See [ADR-0044](../../../../docs/adr/ADR-0044-development-import-stabilization.md).

HTTP: authenticated GET preview and POST consent under
workspaces/:workspaceId/development-import. Owner/lead only; Projects and Tasks
must be enabled. The returned preview/consent is never permission to skip fresh
authorization at write time. Consent creation writes only a hashed consent record.
There is no public apply/import endpoint or development dashboard yet.

The CLI and API share packages/shared-types/development-plan.cjs. The CLI also
proposes workspace creation; the API requires one authenticated existing workspace.
Durable mappings have precedence over title hints; collisions fail closed.

Internal import stages run only in the caller's withUser transaction. Catalog
writes serialize by workspace and lock the role row. Dependency updates also lock
the canonical graph and use revision checks. Task writes require TaskOperations;
no direct Task/TaskDependency writes or imports of concrete neighboring services.
These helpers are not a complete consent-gated import API.

Mappings are included in backups and remapped on workspace transfer. Consent is
ephemeral, excluded from restore/sync, and scoped to user/workspace/catalog/preview/
selection. Agent execution, acceptance and task completion remain separate.

Verification and remaining release gates:
[stabilization report](../../../../development/LOCAL_STABILIZATION_2026-11-02.md).

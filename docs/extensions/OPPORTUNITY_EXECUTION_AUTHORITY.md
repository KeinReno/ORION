# Execution delegation authority

Status: implemented, 16 October 2026. `NEW_EXTENSION_POINT_REQUIRED` was identified during the Hub review: queued manager grants remained usable after policy expiry or disabling the manager until a manager read/run happened.

The Execution plugin owns the typed `ExecutionAuthorityRegistry` extension point, exported by its `public.ts`. A delegation provider registers a namespace and a transaction-scoped read check. Manual grants have no delegation reference. Unknown namespaces, missing providers and failed checks deny execution. The manager contributes `policy:<id>` checks for enabled state, owner/workspace/profile/connection scope, active state, expiry, quiet hours and unresolved sends.

Execution calls the provider at claim, heartbeat and reserve. It never imports manager internals or its concrete module. A provider cannot reserve a send or bypass content checks, one-time grants, account limits or evidence rules. Registration happens during module initialization before requests are accepted. No Core/Base or persisted schema changes are required.

Validation: `opportunity-manager.integration.test.ts` covers expiry, disabled provider, quiet hours and uncertainty without reading the manager UI first. Existing manual execution and default-off retention checks remain mandatory.

# Transactional capability lifecycle

`NEW_EXTENSION_POINT_REQUIRED`: §3.1 of the Hub specification requires disabling a dependency to invalidate unexecuted grants permanently. Previously the Core only stored an enabled flag, so disable → enable within a grant's TTL resurrected send authority.

Implemented public Core contract: `common/capability-lifecycle.ts`. A contribution registers a unique handler; module/plugin configuration calls it inside the same user-scoped transaction. Handler failure rolls back the configuration change. Core knows no concrete plugin or domain table. Workspace row locking serializes override updates.

Execution contributes revocation for its dependencies and the host module: connection paused, pairing invalidated, queue canceled, unreserved running work marked canceled, grants revoked. Manager contributes paused policies and revocation of its pending work when it is disabled. Re-enabling never recreates grants or resumes a connection/policy. Historical/reserved work is retained for result/reconciliation.

Lock order is workspace → policy (manager contribution only) → connection → attempt → grant as applicable. Runner reads the workspace and policy without write locks, then locks connection → attempt; enqueue locks connection before reading state, so a concurrent disable cannot be bypassed by a stale read. Extension callbacks must remain bounded, transactional, and free of network/OS side effects.

No persisted schema changes. Validation: execution limits/dependency disable, manager authority, Hub off/on acceptance and ordinary Core plugin/module suites.

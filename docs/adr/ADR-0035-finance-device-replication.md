# ADR-0035 — Finance device replication v1

Status: accepted for implementation, 2026-10-26. Implements the owner's instruction
to proceed with the server slice of FINANCE_DEVICE_SYNC, not production acceptance.

Finance owns a controllerless public replication SDK. A separately composed,
default-off `finance-device-sync` plugin exposes versioned capability/snapshot/
command endpoints through that SDK. Core Sync protocol1 and its entity set stay
unchanged. Base Finance never imports the plugin. The host composes its module.

First server slice supports full authoritative snapshots and commands for simple
income/expense on existing accounts/categories. Complex transfers, reconciled,
imported and linked operations are read-only. No automatic local account import.

Finance-owned device receipts atomically record each operation with its domain
write. Identity is user/workspace/device/opId; server computes a canonical body
hash. Replay with another body conflicts. Receipts are retained without expiry;
they are not portable workspace content and are never silently pruned.

Finance-owned version/tombstone rows persist a monotonic per-transaction revision.
PostgreSQL triggers update it on header and line mutations from ALL write
paths, without modifying the old Transaction DTO. Delete retains the revision;
new device creates may not reuse an existing entity/tombstone ID. Legacy CRUD
behavior remains unchanged. Receipt lookup rechecks current account visibility.
The metadata-only trigger function uses SECURITY DEFINER with pinned search_path
and revoked public EXECUTE: account cascade may hide the account before its
transactions are removed, while the version tombstone must still be maintained.
It has no callable parameters, no dynamic SQL and returns no financial content.
Reads of versions/receipts remain FORCE RLS. A unique version reservation also
blocks ID reuse when a tombstone is hidden by a deleted/private account.

Initial device reads use bounded full snapshots in a repeatable-read RLS transaction;
clients replace only the remote scope after a complete successful response. A
full snapshot handles removals/access loss without a public incremental change feed.
Incremental cursors are deferred; no arbitrary truncation is accepted as a full copy.
This deliberately narrows the proposal's first implementation step. Tombstones
remain available internally for CAS/create protection and later incremental feed.

Commands require an enabled Finance/plugin, membership, hybrid workspace and a
registered, non-revoked device belonging to the caller. Config/device row locks
serialize disable/revoke against command authorization. Entity locks serialize
receipt/CAS/domain write. Account/category references and private-account RLS are
checked within the original transaction. Revisions conflict instead of money LWW.

Schema migration is additive, includes FORCE RLS, ownership and snapshot registry
classification. Validate real PostgreSQL replay/race/CAS/line trigger/RLS/rollback
and disabled-extension behavior before publishing server runtime. Android and live
profile migrations are separate acceptance steps, not implied by this ADR.

# Opportunities Execution — R1.1 (управляемая отправка HH)

Optional plugin `opportunities-execution`, default-off, extends `opportunities`; needs `opportunities-profiles` and `opportunities-assistant`. Owns the HH **connection**, **attempts** (one send of one approved text), one-time **grants**, and the persistent daily **budget**. Everything is owner-only. Disabling blocks the API and the runner and keeps every record; re-enabling restores access, never execution (jobs still need a live grant).

**What is and is not implemented.** The server side of the executor protocol is real and tested. The **browser adapter for hh.ru is NOT implemented** and no real application was ever sent. `scripts/hh-runner` contains the adapter-independent reference loop (`runner-loop.mjs`), a simulated adapter and a CLI that only works with `--simulate`. A real adapter needs an explicit owner decision for a concrete account and action (G20) — see the progress document.

## States
`awaiting_approval → queued → running → confirmed`; side exits `rejected`, `canceled`, `failed_before_send`, `sent_unconfirmed`, `already_exists`, `needs_user_action`. A saved/approved draft, a grant, and a confirmed send are three different things:
- **Draft approval** (assistant): the owner accepted a text. Not permission to send.
- **Grant** (`POST attempts/:id/approve`): permission for ONE attempt, bound to `payloadHash` (recipient + profile + exact text + material hashes), TTL 5–120 min (default 30), single use. Created only if the current dry run has the same hash and no blockers; review notes (unmet must-haves, hard profile limits) need explicit acknowledgement.
- **Confirmed**: a runner-observed `event_id`/`message_id`/`ui_transition` evidence for the same account and vacancy, not earlier than the reserved submit. A screenshot, a note or a bare "success" never confirms. Owner reconciliation records `owner_attested` and the UI says so.

Any change to the text, the selected resume, the recipient or the profile changes the hash: the grant is revoked on the next read/claim/reserve (`content_changed`) and the attempt needs a new approval.

## Protocol `opportunities-executor/v1` (capability token `ohr_…`, not the user JWT)
| Call | Purpose |
| --- | --- |
| `POST bind` | one-time pairing code (`ohp_…`, 15 min, stored hashed) → runner token (shown once, stored hashed) + the account id the runner reports |
| `POST claim` | single job per connection (row-locked); re-checks owner role, plugin, connection state, daily budget, grant, **current content hash**; lease 60 s |
| `POST heartbeat` | extends the lease; returns `cancelRequested`, `paused`, `grantValid` |
| `POST reserve` | **mandatory checkpoint before the click**: re-verifies cancel/pause/grant/content/account, existing-response baseline, min interval, and atomically takes the daily budget (`INSERT … ON CONFLICT … WHERE used < limit`, advisory lock per account); consumes the grant |
| `POST result` | outcome + evidence; `decideOutcome` is the only mapping from outcome to state |

Fail-closed rules: uncertainty after `reserve` is `sent_unconfirmed` (lost lease, browser lost, failure/user action after the click). It is never retried and never reported as "not sent"; the vacancy stays blocked (partial unique index `opportunity_attempt_one_live`) until the owner reconciles. Reconcile "not sent" allows a NEW attempt with a new approval; reconcile never sends. A lease that expires before `reserve` returns the job to the queue. A late confirming result for a `sent_unconfirmed` attempt is accepted only with qualifying evidence.

Limits: default 5/day per account (max 20), min interval 180 s (60–3600), local day in the connection time zone. One HH account = one budget even across profiles (keyed by the account id the runner reported). 3 consecutive *system* failures pause the connection with a visible reason; platform/user-action failures do not count. Pause/stop: pause cancels the queue and revokes grants; a running job that has not passed `reserve` is told to abort (heartbeat ≤15 s, and `reserve` hard-refuses); a send already started is never called canceled.

Rights are re-checked on every runner call as the connection owner (`withUser`): if the owner is no longer a workspace owner the connection is paused (`rights_revoked`).

## Data and backup
`OpportunityConnection` (hashes only; never a password/cookie/session — the HH session lives in the user's own browser), `OpportunityAttempt`, `OpportunityGrant`, `OpportunityBudget`. FORCE RLS, composite workspace foreign keys, DB barriers: one live-or-successful attempt per vacancy and profile, one active grant per attempt, one live connection per profile, budget range check. Backup: connections come back as `pending_link` with token/pairing erased (the hash is not even written to the file), open attempts are cancelled (a started one stays `sent_unconfirmed`), grants are not carried, the daily counter is **not** rolled back by a restore.

Known limits: no screenshot bytes yet (only hashes/refs in evidence); no cron — lease/grant expiry is applied lazily on reads and runner calls; real-HH pause latency remains unmeasured (the `reserve` check is the hard guarantee); one connection per profile; owner-only (no per-member accounts).

Review update, 16 October: the reference runner now polls stop every second, aborts pending preparation via AbortSignal/abort, re-observes account and baseline after preparation, and passes the approved payload/account to the adapter's final submit check. This is a reference-loop guarantee under a responsive local API, not measured real-HH latency. Connection state is read after its row lock; attempt/grant operations share an attempt-first lock order; expiry uses UTC timestamp semantics and skips locked work. Confirming evidence requires a non-empty event/transition reference and cannot precede reservation or be dated in the distant future.

Delegated work must pass the public `ExecutionAuthorityRegistry` at claim, heartbeat and reserve. Missing/disabled authority fails closed. See `docs/extensions/OPPORTUNITY_EXECUTION_AUTHORITY.md`; Execution has no manager import.

The Core `CapabilityLifecycle` contract invokes an Execution contribution in the configuration transaction. Disabling profiles, assistant, execution or the Base host permanently revokes pending grants, cancels queued work, requests cancel before reserve, invalidates unused pairing codes and pauses linked connections. Re-enabling does not resume links or resurrect grants. Result/reconciliation history and already reserved sends remain intact. Configuration rollback and concurrent overrides are tested; see `docs/extensions/CAPABILITY_LIFECYCLE.md`.

Tests: `exec-core.test.ts`, `apps/api/test/opportunity-execution*.integration.test.ts` (PostgreSQL: protocol, invalidation, races, restore, rights), `scripts/hh-runner/runner-loop.test.mjs`, `e2e/opportunity-execution.spec.ts`.

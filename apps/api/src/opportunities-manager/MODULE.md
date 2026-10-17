# Opportunities Manager — R1.2 (ИИ-менеджер, ограниченная автономность)

Optional plugin `opportunities-manager`, default-off, extends `opportunities`; needs profiles, assistant and execution. Owner-only. A **policy** is an explicit, expiring, limited delegation for ONE linked HH connection. Disabling blocks the API and keeps every policy, action and attempt.

**There is no language model and no background scheduler.** The "manager" is a deterministic pipeline over the assistant's rules (rules-v1): it runs only when the owner presses "Запустить цикл" (`POST policies/:id/run`). No live HH send was ever performed; sends it queues are executed by the separate runner under the same protocol and checks as manual sends.

## Policy (what the owner grants)
`connectionId` (profile comes from it), `minScore` (50–100, default 70), `minConfidence` (medium/high), `requiredFactIds` (must be confirmed facts of that profile), `dailyLimit` (≤ 20 and ≤ the connection's limit), `maxTotal` (≤ 100 actions for the policy's life), optional `quietHours`, `expiresInDays` (≤ 30), and a mandatory `acknowledgeAutonomy: true`. One live (active|paused) policy per connection (DB index). States: `active`, `paused`, `stopped` (final), `expired` (final, applied lazily on read/run). Caps are also DB CHECK constraints. The manager cannot edit or extend a policy; changes are owner actions with CAS on `revision`. Resume is refused when the policy is expired/exhausted, the connection is not linked, or an attempt of the policy is `sent_unconfirmed`.

## A cycle
For up to 10 not-yet-processed `new` HH cards (oldest id first) **each in its own transaction** (a failure rolls back that card only):
1. Preflight: policy active, not expired, remaining > 0, connection linked, not in quiet hours, **no uncertain send** (otherwise the policy is paused with a visible reason).
2. Assess (assistant) → gates (`manager-core.ts`): a hard profile limit, a score below the threshold, a disputed must-have or a missing required fact → **skipped**; unknown/uncomparable salary or location, an unmet must-have, no active resume, low confidence → **needs_review** (a human decides, nothing is queued); text inside the vacancy has no influence (structured fields only).
3. Only a clean card proceeds: daily manager counter taken atomically in the DB (`INSERT … ON CONFLICT … WHERE used < limit`), draft built from confirmed facts, **approved by `policy:<id>`** (refused if any section is unverified/empty/manual), policy `remaining` decremented atomically, attempt queued with a short grant (15 min) granted by `policy:<id>` and `initiatedBy = policy:<id>`.
4. One `OpportunityManagerAction` per (policy, card) — unique in the DB — records `queued` / `skipped` / `needs_review` / `failed` with reasons. Re-running or racing cycles cannot process a card twice; a card that stopped the cycle on a limit is left unmarked.

The executor still enforces everything on the actual send: current content hash, `reserve` checkpoint, account budget and minimum interval, evidence-bound confirmation. A policy therefore cannot exceed the connection's limits.

## Stop, pause, expiry, restore
Pause/stop/expiry cancel the policy's unstarted attempts and revoke their grants (`cancelByPolicyTx`); a running job that has not passed `reserve` is told to abort; a send already started is never called canceled. An uncertain send of the policy pauses it until the owner reconciles. **Restore returns every policy `paused`** (revision bumped) with its journal; the policy's queued attempts are cancelled by the execution restore rules; the manager's daily counters are not rolled back.

## Report
`GET policies/:id/report` — policy, today's queued vs limit, totals by action state, **outcome of the attempts this policy queued** (confirmed / waiting / unconfirmed / canceled / failed…), and a page of actions with reasons (opportunity titles via the Base read port).

Ports used: `OPPORTUNITIES_READ_PORT.v1` (list candidates), `PROFILE_EVIDENCE_PORT.v1`, `ASSISTANT_AUTOMATION_PORT.v1` (assess, draft, approve-for-policy), `EXECUTION_AUTOMATION_PORT.v1` (queue, cancel, stats). Tests: `manager-core.test.ts`, `apps/api/test/opportunity-manager.integration.test.ts`, `e2e/opportunity-manager.spec.ts`.

Review update, 16 October: the candidate read port supports stable `afterId` pagination, so 200 previously processed cards do not starve newer ones. The manager registers its live policy authority through the Execution public registry: disabled manager, expired/paused/stopped policy, wrong scope, quiet hours and uncertain sends block claim/reserve even if nobody opens the manager screen. No background scheduler is needed for these safety checks.

Its Core lifecycle contribution also pauses policies and revokes their pending work atomically when the manager is disabled. Re-enabling requires an explicit resume; old grants never revive.

Known limits: manual trigger only; one action type (apply, HH vacancies in status `new`); no message replies, no offers/contracts (the manager never accepts conditions); the policy grants cannot be partially edited; a card skipped by the thresholds is not re-evaluated until the owner starts a new policy; time-of-day windows use the connection's time zone.

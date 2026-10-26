# ADR-0035: Explicit publication rules, first vertical slice

Status: accepted for implementation by owner, 26.10.2026.
Supersedes ADR-0024's manual-refresh-only restriction **for explicitly enabled rules**.

Shared remains the platform owner of controlled exchange; Tasks owns task queries
and registers its adapter. A rule is an opt-in platform exchange policy, not new
Tasks business logic. We considered a Tasks plugin, but it would duplicate the
cross-domain policy engine when Knowledge is added. No module ownership is moved;
there is no import of concrete Tasks in Shared. Source-specific filtering remains
in PublicationAdapter. Existing manual publications retain their behavior.

Owner-approved direction:
- owner approves by default; explicitly appointed reviewers may approve later;
  absence alone never grants authority;
- explicit Family/Restricted permission presets operate only on selected shared
  data; permission administration and personal sources remain separate;
- start with Tasks, then Knowledge;
- update only explicitly selected fields automatically; expanding disclosure
  requires a new preview and confirmation;
- withdraw when source exits the filter; retain history and independent copies;
- first offline scope is cached reading and pending task-status intentions;
- first inter-node topology has one authoritative coordinator and independent
  personal databases. These later capabilities are **not implemented by this ADR's
  first slice** and must not be advertised as available.

The agreed permission/UX direction for subsequent slices is specific:
- Family is explicitly chosen, with shared read/create/edit and recoverable
  deletion; Restricted starts with reading, optional task-status delegation.
  Per-user overrides are explicit. Neither preset includes member/permission
  administration or access to unshared personal fields by implication.
- The owner may appoint reviewers in advance. They do not gain new authority
  when the owner disconnects, and cannot approve while the coordinator is offline.
- Offline initially means cached reading plus durable task-status intentions,
  not unrestricted offline editing. Delivery rechecks revocation and revisions.
- No specific machine has yet been selected as the coordinator. That deployment
  decision is needed for real Orion Link acceptance, not for these local rules.

First slice: source owner creates a paused task rule, previews up to 100 current
matching records, sees destination participants and exact projections, and enables
with CAS, preview fingerprint and explicit consent for future records. Filters:
project ids and statuses (empty = any). Fields: title/status, optional text/dueAt.
Status delegation is independently explicit; no Family label implies unrestricted
access to original records. Editing is allowed only while paused, and re-enabling
requires a fresh preview. Pausing stops future processing and retains last published
snapshots; deletion deactivates the rule and withdraws its active publications.

Tasks emits `tasks.task.changed` transactionally for creates/updates/deletes and
recurrence-created tasks. The existing outbox delivers a Shared adapter subscriber
gated by source Tasks availability. Delivery rereads current source state and
permissions, never trusts old event content. A bounded periodic reconciliation
using existing background jobs covers direct/sync writes and lost/disabled-event
windows. No second event bus or transport.

Rule-managed publications use a stable unique (ruleId, sourceId) association.
Revoked rows are tombstones: neither outbox replay nor filter re-entry reactivates
them. Creating a new rule is a fresh explicit disclosure decision. Existing manual
publications are not adopted or overwritten by a rule. Copies contain no rule
association and remain independent. Publication DTOs never expose rule/source ids.

Rules and previews are private to the creating source owner, FORCE RLS. Background
enumeration is system-scoped, execution resets to the owner's RLS and checks their
current authority. Permission loss disables the rule and withdraws its publications.
Backup restore deactivates rules referencing the restored source or destination;
restored rules are always paused and publications revoked. Old permissions never
resume from a backup. A schema migration requires a full installer.

Limits: asynchronous updates can lag; a failed delivery is not success. Large
previews/runs fail explicitly rather than silently truncating. Schema/contract,
RLS, restore and outbox integration tests must pass before claiming completion.

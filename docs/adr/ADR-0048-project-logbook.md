# ADR-0048: Project Logbook and directed project relations

**Status:** Accepted  
**Date:** 2026-11-09

## Context

`ProjectStatusUpdate` records structured health reports. It does not provide a
general project chronology for observations, decisions, change reasons, or
task references. Projects already has the typed `projects.tabs` contribution
slot. Tasks and Projects have canonical identities and must not be copied to
express context or continuity.

## Decision

- Add `projects-logbook` as a default-enabled built-in Projects plugin using
  the existing `projects.tabs` slot.
- Keep journal entries separate from `ProjectStatusUpdate` and store only
  authored prose, kind, author, and timestamp.
- Link an existing task through a foreign-key join row. Store a comment on that
  join row so it cannot alter the task description or task comments.
- Model project relations as directed edges from the current project to the
  selected project. `continues`, `replaces`, `based_on`, and `depends_on` make
  the target a predecessor and the source a successor. `related` is symmetric
  and canonicalized to one edge per pair.
- Enforce workspace membership in RLS and re-check that both endpoints belong
  to the requested workspace in the service.
- Preserve all journal records and relations when the plugin is disabled.

## Consequences

The plugin owns journal and relation APIs/UI; Projects owns project identity,
and Tasks owns task identity and content. The existing host slot is sufficient,
so no extension proposal is needed. The new tables participate in backup and
restore. See [`PROJECT_LOGBOOK.md`](../platform-api/PROJECT_LOGBOOK.md) for the
HTTP and storage contract.

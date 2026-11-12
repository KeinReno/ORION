# PROJECT LOGBOOK

**Status:** implemented with migrations `20261109130000_project_logbook`
(first slice) and `20261111120000_logbook_typed_entries` (typed entries,
auto entries from domain events, filters and summary).
This contract supplements, and does not replace, the structured
[`ProjectStatusUpdate`](../../apps/api/src/projects/project-updates.service.ts)
reports.

## Ownership

`projects-logbook` is a built-in, default-enabled plugin of Projects. It adds
the `projects.tabs` contribution `logbook`; Projects Base remains usable when
the plugin is disabled. Disabling it hides the tab and routes while preserving
all journal data. The journal subscriber is declared with
`componentId: "projects-logbook"`, so a disabled plugin receives
`skipped_disabled` deliveries instead of writing auto entries.

## Journal entries

`ProjectLogEntry` stores a `type`, the authored text, author, optional
structured fields and the creation/update time. Types:

| Type | Required / allowed fields |
|---|---|
| `observation` | text only |
| `decision` | `rationale` (required), `alternatives` (`[{ option, whyNot }]`) |
| `hypothesis` | `verificationDue` (optional ISO datetime) |
| `result` | `confirmsEntryId` (optional, same project, must point to a hypothesis or decision), `verdict` (`confirms`/`refutes`) |
| `incident` | `severity` (`low`/`medium`/`high`, required), `resolution` (optional note) |
| `change` | `source` (`manual`/`event`); manual change is allowed |

Fields outside the row's type are rejected with `422` and a field map:

```json
{
  "statusCode": 422,
  "code": "logbook_entry_invalid",
  "message": "Поля записи не соответствуют её типу",
  "errors": { "rationale": "Для решения обязательно обоснование (rationale)" }
}
```

`type` is the current contract name; responses also carry the historical
`kind` alias for older clients. The storage column is `type`.

HTTP routes, all guarded by Projects and `projects-logbook`:

- `GET /workspaces/:workspaceId/projects/:projectId/logbook`
- `POST /workspaces/:workspaceId/projects/:projectId/logbook`
- `PATCH /workspaces/:workspaceId/projects/:projectId/logbook/:entryId`
- `DELETE /workspaces/:workspaceId/projects/:projectId/logbook/:entryId`
- `GET /workspaces/:workspaceId/projects/:projectId/logbook/summary`
- `GET /workspaces/:workspaceId/project-log` (workspace-wide, same filters)
- `GET /workspaces/:workspaceId/project-log/:entryId/related`

List filters (query, all optional): `type`, `authorId`, `from`, `to`
(ISO datetimes), `projectId` (workspace-wide endpoint), `hasTasks`
(`true`/`false`), `includeChildren` (`true` by default) and `limit` (max 200).
`includeChildren` walks `Project.parentId` through a recursive CTE; when the
hierarchy column is absent, the filter behaves as “this project only”.

POST body:

```json
{
  "type": "decision",
  "text": "Берём проверку в текущий цикл",
  "rationale": "Иначе релиз не проверить на чистом профиле",
  "alternatives": [{ "option": "Отложить", "whyNot": "Сроки" }],
  "tasks": [{ "taskId": "<existing-task-id>", "comment": "Нужна проверка на чистом профиле" }]
}
```

Each task id must resolve in the same workspace. The journal stores only the
foreign-key reference and the link-specific comment. Task title/status/project
are read from the Tasks-owned `TaskReferenceReader` projection inside the
caller's authorized transaction; Projects reads only the name of the
referenced project. Journal writes never update Task fields or TaskComment
rows. Removing a task removes its journal link, while the entry remains.

Manual entries are editable/deletable by their author or a workspace
owner/lead. Event entries are read-only through the API and are removed
together with the project.

## Automatic change entries

The journal subscribes to the domain-event bus (ADR-0019) and writes
`type: "change"`, `source: "event"` entries with the source event id/type:

- `projects.project.status_changed`
- `projects.project.dates_changed`
- `projects.milestone.completed`
- `projects.milestone.dates_changed`
- `tasks.task.assigned`

Bulk operations publish several events with a shared `bulkId` (and optional
`bulkLabel`). The subscriber stores `bulk:<eventType>:<bulkId>` in
`dedupeKey`; the unique index `(projectId, dedupeKey)` guarantees one entry per
bulk operation, and `createMany(skipDuplicates)` makes retries idempotent
without aborting the delivery transaction. A milestone cascade reschedule is
one such bulk operation.

## Summary

`GET /projects/:projectId/logbook/summary` returns counts by type for the
period, overdue hypotheses (`verificationDue` in the past), incidents without
a resolution note, and decisions without a confirming result. Lists inside the
summary are capped at 50 each.

## Materials through EntityLinks

`project_log_entry` is a registered `SearchableEntityType` in the universal
EntityLink layer. Materials (notes, documents and any other registered type)
are attached through `POST /workspaces/:workspaceId/links`; the entry table has
no JSON copy of them. `GET /project-log/:entryId/related` aggregates all links
of the entry. Deleting an entry removes its links through the core
`EntityLinkOperations` service.

## Directed project relations

`ProjectRelation` points from the project whose page initiated the operation
to the selected project. Thus `QA-v3 → QA-v2` with `continues` means QA-v3 is a
successor and QA-v2 a predecessor. The same direction applies to `replaces`,
`based_on`, and `depends_on`. `related` is symmetric and is stored in one
canonical direction to prevent duplicate pairs.

Relation types are `continues`, `replaces`, `based_on`, `depends_on`, and
`related`. Self-relations and cross-workspace links are rejected. Projects are
never copied. A creator can remove their link; other members can see it from
both project pages.

- `GET /workspaces/:workspaceId/projects/:projectId/relations`
- `POST /workspaces/:workspaceId/projects/:projectId/relations` with
  `{ "type": "continues", "toProjectId": "<project-id>" }`
- `DELETE /workspaces/:workspaceId/projects/:projectId/relations/:relationId`

## Storage and safeguards

All three tables use `ENABLE` and `FORCE ROW LEVEL SECURITY` with workspace
membership policies. The self-reference `confirmsEntryId` is a deferrable FK
so backup/restore can insert a result before its hypothesis in one transaction.
Service validation additionally checks workspace identity for every linked
project/task; a foreign workspace's object is reported as missing. Journal
tables and relations are included in workspace backup/restore and have explicit
sync classifications. They are not copied when plugin state changes.

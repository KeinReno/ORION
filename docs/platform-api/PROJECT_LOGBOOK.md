# PROJECT LOGBOOK

**Status:** implemented with migration `20261109130000_project_logbook`.
This contract supplements, and does not replace, the structured
[`ProjectStatusUpdate`](../../apps/api/src/projects/project-updates.service.ts)
reports.

## Ownership

`projects-logbook` is a built-in, default-enabled plugin of Projects. It adds
the `projects.tabs` contribution `logbook`; Projects Base remains usable when
the plugin is disabled. Disabling it hides the tab and routes while preserving
all journal data. The extension slot already exists, so no new slot or Core
business logic is introduced.

## Journal entries

`ProjectLogEntry` stores `observation`, `decision`, or `change`, the authored
text, author, and creation time. The user identity always comes from the
session. Entries are listed newest first (maximum 200). An author can delete
their own entry; other members can read it but cannot delete it.

HTTP routes, all guarded by Projects and `projects-logbook`:

- `GET /workspaces/:workspaceId/projects/:projectId/logbook`
- `POST /workspaces/:workspaceId/projects/:projectId/logbook`
- `DELETE /workspaces/:workspaceId/projects/:projectId/logbook/:entryId`

POST body:

```json
{
  "kind": "decision",
  "text": "Берём проверку в текущий цикл",
  "tasks": [{ "taskId": "<existing-task-id>", "comment": "Нужна проверка на чистом профиле" }]
}
```

Each task id must resolve in the same workspace. The journal stores only the
foreign-key reference and the link-specific comment. Task title/status/project
are read from the Tasks-owned `TaskReferenceReader` projection inside the
caller's authorized transaction; Projects reads only the name of the
referenced project. Journal writes never update Task fields or TaskComment
rows. Removing a task removes its journal link, while the entry remains.

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
membership policies. Service validation additionally checks workspace identity
for every linked project/task; a foreign workspace's object is reported as
missing. Journal tables and relations are included in workspace backup/restore
and have explicit sync classifications. They are not copied when plugin state
changes.

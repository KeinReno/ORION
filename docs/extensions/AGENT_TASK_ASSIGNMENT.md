# Extension Proposal: `tasks.context.actions` and Agent Hub task assignment

**Status:** approved for the current implementation slice; Agent Hub UI contribution is being added.

## Context

Tasks and project-task rows already expose context menus, but their menu entries
are host-owned. Agent Hub is an optional module and Tasks must not import its
panel, API client, types beyond the public contract, or persistence layer.
Existing task slots cover views, planning, and detail tabs; none can add an
action to both context menus.

## Proposed extension point

Add the typed `tasks.context.actions` slot. The Tasks host gives a contribution
the workspace, canonical `Task`, origin surface (`tasks` or `project-tasks`),
and controlled open/close state. The contribution declares one menu label and
action id in slot metadata. The host inserts the entry into both the `TaskCard`
and project `TaskTree` menus, and mounts that contribution's dialog only when
selected.

The host owns menu composition and task identity. A contribution owns its
dialog and all feature-specific data access. With no enabled contributions,
the existing menu entries render exactly as before.

## Agent Hub contribution

The optional `agent-hub-task-assignment` plugin extends the `agent-hub` module
and contributes “Назначить ИИ-агента…” through the new slot. It uses only the
public Agent Hub endpoints and shared-types schemas. It lists persistent agent
profiles and the current user's safe credential options, allows creation of a
profile only after selecting a real existing credential, then assigns or
unassigns that profile on the existing task. It never creates a credential or
execution and never starts an agent.

Assignment and execution are separate records and actions. The current
assignment remains visible in the assignment dialog when its credential is
revoked, expired, or missing, with an explicit warning and a path to remove or
replace it. Empty/error/loading states do not fabricate an agent.

## Disable behavior and ownership

When Agent Hub is disabled, the plugin is automatically unavailable and its
menu action disappears. The persisted assignment remains intact. Tasks stays
usable and keeps its built-in context actions. Re-enabling Agent Hub restores
the contribution and reads the existing assignment through the public API.

Tasks owns task identity and its menus. Agent Hub owns logical agent profiles,
task-agent assignments, credentials, and any future execution records. The
plugin crosses that boundary through its public Agent Hub HTTP/shared-types
contract only.

## Acceptance

- Both ordinary task cards and project task-tree rows expose the contribution
  in their existing context menus; built-in actions remain available.
- Turning off Agent Hub removes the contribution without changing task data or
  assignment records.
- The UI shows only server-returned profiles and credentials owned by the
  current user; creation requires a selected credential.
- Assignment saves and removal use the explicit task-assignment endpoint;
  neither operation creates an execution or claims a worker.
- Loading, denied, disabled, stale-credential, and request-error states are
  explicit and retryable where appropriate.

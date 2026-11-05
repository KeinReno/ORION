# ADR-0044 — an agent may delete a task, note or event: at once in «администратор», otherwise as a request (ACCEPTED)

**Date:** 2026-11-05
**Status:** ACCEPTED — owner decision 2026-11-05 («Администратору дать возможность удалять без требования подтвердить от человека», затем «делай»).
**Supersedes:** the clause «удаления у агента нет» in [ADR-0007](ADR-0007-ai-bridge.md) §«Подтверждение опасного». Everything else in ADR-0007 (proposal flow, rights of the human on approve, staleness/CAS, journal) stays in force.

## Problem

The repository states two different things about the same act.

- The token-mode model (ADR-0007 §Режимы, `AgentMode` in `packages/shared-types/src/agent.ts`, `decideAgentOperation` / `decideAgentModuleOperation` in `agent-policy.ts`) short-circuits `admin` to `allow` for **every** operation, including `delete`: only the «Никогда» flags still deny. The manual's mode table, rendered from `agent-manual.ts`, says so in words: «администратор … удаление — сразу, без запроса».
- For tasks, notes and events there is no DELETE verb at all: the only path is `POST /ai/v1/proposals`. `apps/api/test/ai-bridge.integration.test.ts` asserts that (`// There is no delete verb for agents` → 404), and ADR-0007 wrote the prohibition down.

So an administrator token can delete a document, a habit, a list item, a project or a contact **immediately**, but cannot delete a task without a human clicking in Настройках — and the mode table promises it can. Three consequences we actually observed:

1. The manual and `orion_get_context` (`requiresConfirmation`) describe behavior the server does not offer, which is the worst kind of contract drift: an agent reads the promise, calls nothing, and files a request instead.
2. Requests that no human clears pile up. Two deletion requests from one token were still `pending` after a week; one of them names a note that no longer exists, so it can never be approved.
3. The owner's cleanup path for their own space is a click-through queue, while the same cleanup in an optional module is one call.

## Decision

Give the three core entities the same delete door that module tools already have, with the mode policy deciding what happens:

- `DELETE /ai/v1/tasks/{taskId}`, `DELETE /ai/v1/notes/{noteId}`, `DELETE /ai/v1/events/{eventId}` in `AiController`, through the existing `runOp` door (policy → module on → project fence → write budget → act or request → journal). No new guard, no new scope.
- Modes, unchanged in `decideAgentOperation`: `admin` deletes at once; `assistant` and `manager` get `202 { proposed: true, proposal }` — the same request a human approves, produced by the same `AgentJobsService.propose` with `action: "task.delete" | "note.delete" | "event.delete"`; `observer` and any token with «Никогда: удаление» get 403.
- Scopes: `tasks:write` / `notes:write` / `events:write`, as `orion_propose_deletion` already requires. Reading a scope is not enough to delete.
- Semantics of the delete itself are the service's existing ones, deliberately not re-invented: a note goes to the trash (`deletedAt`, restorable), a task is removed, an event is removed **whole, with every occurrence** (`scope = "all"`) — the request and the direct call name the event, not one date. Repeating a recurring event one occurrence at a time remains out of reach for an agent, as in ADR-0007.
- `orion_propose_deletion` (`POST /ai/v1/proposals`) keeps its meaning and its effect: it always files a request, in every mode, including `admin`. It is the tool for «ask a human», not a weaker alias of the new verb.
- A new tool effect `delete` carries the per-mode outcomes (the catalogue is the single source for MCP `tools/list`, `GET /ai/v1/manual` and `orion_get_context`). `delete_request` keeps its old text — «never executed by the agent in any mode» — because for that effect it is still true.
- `agentToolModeNote` now names the `admin` mode as well. Before this, the manual's per-tool «Режимы токена» line listed only наблюдатель/помощник/менеджер, so an administrator token could not see from a tool's own description what it does with it — the same omission that let the contradiction above live.
- The in-app assistant (chat) does **not** gain the new tools when its token can only request deletion: `chatTools()` filters the `delete` effect out exactly as it filters `delete_request` today. The model still cannot delete on its own.

## Not done here, on purpose

- The permission registry (`permissions.ts`) declares `tasks.task.delete`, `notes.note.delete`, `calendar.event.delete`, but no agent scope maps to them (`"tasks:write": ["tasks.task.create", "tasks.task.update"]`). The new routes therefore rely on `runOp`, like the notes/events routes they sit next to, and do not carry `@RequirePermission`. Closing that drift means deciding which scopes grant a delete permission platform-wide — a separate change to the dictionary, not to this door.
- Soft delete and a restore window for **tasks** (notes and documents have a trash; a hard-deleted task does not). ADR-0007 already records that as a product gap («корзины задач в ORION нет»). An agent-visible verb makes the absence cheaper to notice, not acceptable.
- Bulk delete, and delete of objects the token may read but whose module is off (still 409).

## Consequences

- Agents can destroy data in the user's space at once, in one mode only, and the «Никогда: удаление» checkbox plus per-token scope remain the owner's brakes. Every such call lands in the token journal the owner reads in Настройки → «ИИ-агенты», with `module`, `objectId` and 200/202/403.
- `GET /ai/v1/manual`, `docs/AGENT_MANUAL.md` and MCP `tools/list` change text; the consistency test (`agent-gateway.test.ts`) requires each new route to be a catalogue entry, so the manual cannot drift again.
- Two assertions in `ai-bridge.integration.test.ts` are rewritten, not deleted: the 404 «no delete verb» check becomes «manager → 202 request, still pending», and the events check keeps its «no recurrence edit» half and gains the delete door. New coverage: admin deletes a task and a note, the note is in the trash, the event goes whole; 403 for «Никогда: удаление» and for observer; 403 for a read-only scope; `dry-run` of nothing — an agent call either acts or files a request.

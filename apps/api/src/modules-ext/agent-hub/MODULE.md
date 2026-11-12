# Agent Hub module

Optional module for persistent execution attempts. First waves store queue records, events and cancellation, and allow explicit manual MCP execution; no autonomous executor is enabled.

- Source of user tasks: Tasks public reader; never duplicate task body or mutate Tasks directly.
- Existing AI Bridge still owns messages, tokens, scopes, proposals and agent audit.
- Agent Hub owns `AgentHubExecution`, `AgentHubEvent` and ephemeral `AgentHubRuntimeSession` (excluded from snapshots).
- Workspace isolation: `withUser` + membership, database FORCE RLS.
- Owner/lead-only writes, CAS cancellation and a journal row in the same transaction.
- Three **manual MCP** tools are available: queue, claim, report. Worker identity/time are bound server-side to the authenticated agent token; all calls require scoped module permissions and tasks:read, plus project-fence checks.
- The optional, human-only reconcile endpoint requeues timed-out leases, retaining checkpoint references; no background scheduler exists.
- No agent-driven verification or task completion; submit means review, never done. No automatic IDE launch.
- Snapshot policy: both executions and events included, in that order.
- Runtime registry tracks authenticated bearer-token session reports with a 5-minute TTL and CAS. Presence states are `recent`, `stale`, `closed`: NOT CLI process attestation or an approval to start models.
- Runtime registry is exposed to humans via GET /runtime-sessions and to agents via register/pulse/close MCP tools; no background scheduler.
- Runtime unavailable means `queued`, never `online`; manual MCP remains distinct.
- Disabling the module preserves all records.
- Stable `AgentHubAgentProfile` identities are distinct from AI Bridge credentials and runtime sessions. A human owner/lead explicitly links their own eligible credential; names do not merge credentials into an identity.
- A task's executor assignment points to a profile. It does not create an execution attempt, wake an IDE, or dispatch work. Explicit execution creation remains a separate action.
- Tasks and Agent Hub serialize agent/human assignment through the public `TaskAgentAssignmentRegistry` and a row lock on the canonical Task. A claimed or working run prevents reassignment to a different profile until it stops.
- Profiles and task assignments are included in backup; credential bindings are excluded. Restore preserves assignment and reports `missing` until the owner explicitly rebinds a credential to the same profile.
- Hard-deleted Task references remain historical Agent Hub rows; API reads first verify the Task through `TaskIntegrationReader`, so an orphan is not shown as a live assignment.
- **Delegation (task 09.1).** A working branch may hand a structured sub-order to another agent profile: `parentExecutionId`, `delegationDepth`, `delegationChain` (profile ids, cycle guard), `delegatedToProfileId` and `delegationPayload` (summary, instructions, task/project, `materialLinkIds`, permission constraints). Depth is bounded by the owner policy (`agent_hub_policies`, default 3, only the owner/lead sets it; a delegator may tighten it). `A → B → A` and depth above the limit are 409 `delegation_cycle` / `delegation_depth_exceeded`. The parent's revision never moves because a child branch exists; the delegation is a trace fact.
- **State machine (task 09.1/9.4).** Statuses keep their previous wire values and gain `waiting_approval` and `reassigned` (both additive). Only the allowed transitions are accepted; every one writes an `AgentHubEvent` in the same transaction as the state. `request_approval` pauses an operation above read-only until the owner approves or rejects; `reassign` ends the branch and opens an independent replacement for the same target with a new journal. `reassigned` is terminal and frees the one-active-execution index.
- **Trace (task 09.2).** `AgentHubTraceStep` stores actual facts only: `tool_call | tool_result | delegation | approval_wait | note | error`, `stepId`/`parentStepId` tree, server-computed duration, error and attempt. `GET …/executions/:id/trace` returns the flat list and the tree; `type`, `stepId`, `agentId` and `depth` narrow the same endpoint. Model reasoning is never captured or reconstructed.
- **Memory (task 09.3).** `AgentMemoryRecord` is scoped (`user | project | agent | global`) and versioned: a rewrite inserts a new `valid` row and marks the previous `superseded` (`supersededById`), while `outdated` means "recheck". The partial unique index keeps one valid row per scope/agent/key. User memory written by an agent is private to that profile (another agent gets 403); project memory follows the token's project fence. `POST …/context` collects scoped memory plus the capabilities the caller may use, with size limits and outdated/superseded warnings. Agent reads/writes are audited through `AgentAuditEntry` by `AgentModuleToolsService`.
- Delegation, trace steps, memory and the policy are included in the snapshot; the self-references (`parentExecutionId`, `supersededById`) deliberately have no FK so restore does not depend on row order.

See `docs/adr/ADR-0036-agent-hub-execution-foundation.md` and `docs/agent-hub/ROADMAP.md`.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `agent-hub` / 1.1.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `tasks` |
| Права (permissions) | `agent-hub.execution.read`, `agent-hub.execution.create`, `agent-hub.execution.update`, `agent-hub.execution.delete`, `agent-hub.runtime.create`, `agent-hub.memory.read`, `agent-hub.memory.create`, `agent-hub.memory.update`, `agent-hub.policy.read`, `agent-hub.policy.update` |
| События | публикует: —; слушает: — |
| Панели веба | `agent-hub` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/agent-hub` |
| Плагины, расширяющие модуль | `agent-hub-task-assignment` |
| Миграции в манифесте | `20261029202000_agent_hub_executions`, `20261029223000_agent_hub_runtime_sessions`, `20261110140000_agent_hub_agent_assignments`, `20261111200000_agent_hub_orchestration`, `20261111201000_agent_hub_memory_trace`, `20261111202000_agent_hub_memory_agent_scope` |
| Код на сервере | `apps/api/src/modules-ext/agent-hub/` |
| При выключении | Останавливает доступ к API/панели, но не удаляет исполнения и журнал. Автодиспетчер пока отсутствует. |
<!-- generated:manifest:end -->

F3d note: runtime register/pulse/close require dedicated `agent-hub.runtime.create`, not `agent-hub.execution.create`. A presence observer must never inherit worker claim rights.

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

See `docs/adr/ADR-0036-agent-hub-execution-foundation.md` and `docs/agent-hub/ROADMAP.md`.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `agent-hub` / 1.0.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `tasks` |
| Права (permissions) | `agent-hub.execution.read`, `agent-hub.execution.create`, `agent-hub.execution.update`, `agent-hub.execution.delete`, `agent-hub.runtime.create` |
| События | публикует: —; слушает: — |
| Панели веба | `agent-hub` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/agent-hub` |
| Плагины, расширяющие модуль | `agent-hub-task-assignment` |
| Миграции в манифесте | `20261029202000_agent_hub_executions`, `20261029223000_agent_hub_runtime_sessions`, `20261110140000_agent_hub_agent_assignments` |
| Код на сервере | `apps/api/src/modules-ext/agent-hub/` |
| При выключении | Останавливает доступ к API/панели, но не удаляет исполнения и журнал. Автодиспетчер пока отсутствует. |
<!-- generated:manifest:end -->

F3d note: runtime register/pulse/close require dedicated `agent-hub.runtime.create`, not `agent-hub.execution.create`. A presence observer must never inherit worker claim rights.

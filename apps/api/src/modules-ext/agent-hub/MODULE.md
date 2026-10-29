# Agent Hub module

Optional module for persistent execution attempts. First wave stores queue records, events and cancellation; no autonomous executor is enabled.

- Source of user tasks: Tasks public reader; never duplicate task body or mutate Tasks directly.
- Existing AI Bridge still owns messages, tokens, scopes, proposals and agent audit.
- Agent Hub owns only `AgentHubExecution` and `AgentHubEvent`.
- Workspace isolation: `withUser` + membership, database FORCE RLS.
- Owner/lead-only writes, CAS cancellation and a journal row in the same transaction.
- No user-supplied claim, heartbeat or verify endpoint before a trusted coordinator exists.
- Snapshot policy: both executions and events included, in that order.
- Runtime unavailable means `queued`, never `online`; manual MCP remains distinct.
- Disabling the module preserves all records.

See `docs/adr/ADR-0036-agent-hub-execution-foundation.md` and `docs/agent-hub/ROADMAP.md`.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `agent-hub` / 1.0.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию выключен |
| Жёсткие зависимости | — |
| Мягкие зависимости | `tasks` |
| Права (permissions) | `agent-hub.execution.read`, `agent-hub.execution.create`, `agent-hub.execution.update`, `agent-hub.execution.delete` |
| События | публикует: —; слушает: — |
| Панели веба | `agent-hub` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/agent-hub` |
| Плагины, расширяющие модуль | — |
| Миграции в манифесте | `20261029202000_agent_hub_executions` |
| Код на сервере | `apps/api/src/modules-ext/agent-hub/` |
| При выключении | Останавливает доступ к API/панели, но не удаляет исполнения и журнал. Автодиспетчер пока отсутствует. |
<!-- generated:manifest:end -->

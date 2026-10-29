# Agent Hub — AI context

Read this module's MODULE.md, docs/AGENT_HUB_ARCHITECTURE.md and ADR-0036.
This is a registered but NOT AUTONOMOUS module. No IDE launches, scheduler
or agent-to-agent dispatch exists in this wave. Do not conflate Task status,
AgentJob status and the execution state machine.

Server code calls TaskIntegrationReader through its public module, never Tasks
internals. Model code must not infer an online runtime from token presence.

<!-- generated:manifest:start -->
## Для агента (генерируется)

Блок собирается `pnpm module-docs`; руками не править.

- Точки входа: API `workspaces/:workspaceId/agent-hub` (за `@RequireModule("agent-hub")`); панель веба `agent-hub`; код `apps/api/src/modules-ext/agent-hub/`.
- Права: `agent-hub.execution.read`, `agent-hub.execution.create`, `agent-hub.execution.update`, `agent-hub.execution.delete`.
- Модуль владеет: Исполнения и атомарная история их изменений; задачи и полномочия остаются за соответствующими модулями и AI Bridge.
- Соседи: жёсткие: —; мягкие: `tasks`; чужие данные читать только через их публичный контракт, мягких соседей спрашивать через `isEnabled`.
- Расширения: плагины: —.
- Выключение модуля не удаляет данные; новые таблицы — только с ENABLE + FORCE RLS и записью в реестре снапшота.
<!-- generated:manifest:end -->

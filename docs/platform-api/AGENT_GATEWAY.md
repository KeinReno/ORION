# Agent Gateway API (G13, G14)

Решения — [ADR-0018](../adr/ADR-0018-agent-gateway.md), [ADR-0007](../adr/ADR-0007-ai-bridge.md); руководство —
[AGENT_MANUAL.md](../AGENT_MANUAL.md) (генерируется).

## Как сейчас (v1.0, зафиксировано)

- **Версия:** `AGENT_API_VERSION = "1"` (`packages/shared-types/src/agent-gateway.ts`), отдаётся в `GET /ai/v1/context`.
- **Маршруты.** Для человека: `workspaces/:workspaceId/agent-tokens` (токены, `audit`, `audit/:id/undo`, `proposals/*`,
  `revoke-all`) — `apps/api/src/ai/ai.controller.ts`; мастер подключения `workspaces/:id/agent-connection`
  (`agent-connection.controller.ts`). Для агента `ai/v1/*` (`AgentTokenGuard`): `me`, `tasks`, `notes`, `events`, `projects`,
  `finance/refs`, `finance/drafts`, `agents`, `messages`, `jobs`, `proposals` (`ai.controller.ts`) и `context`, `manual`,
  `capture`, `search`, `links` (`agent-gateway.controller.ts`).
- **Токен:** префикс `orion_agt_`; действует правами выдавшего участника в одном пространстве, не шире (`agent.ts`). Scope'ов 11
  (`AGENT_SCOPES`); режимы `observer|assistant|manager`; матрица модуль × операция; флаги `AGENT_FORBIDDEN`
  (`finance`, `documents`, `delete`); лимит записи в час; `allowedProjectIds`; срок. Решение по операции — `decideAgentOperation`
  (`packages/shared-types/src/agent-policy.ts`).
- **Каталог инструментов:** `AGENT_TOOLS` (28, `packages/shared-types/src/agent-tools.ts`). Из него генерируются список MCP
  (`apps/api/src/mcp/orion-mcp.ts`, обёртка `scripts/orion-mcp.mjs`, stdio), руководство и тест «инструмент ↔ маршрут» в обе стороны.
- **Контекст:** `GET /ai/v1/context` — пространство, роль, scopes, только достижимые включённые модули, `capabilities`
  (`apps/api/src/ai/agent-gateway.service.ts`, около строк 130–139).
- **Прочее:** идемпотентность capture (`agent_captures`), журнал аудита и откат (`agent-undo.service.ts`), предложения на
  подтверждение, задания и сообщения между агентами (`agent-jobs.service.ts`), rate-limit (`rate-limiter.ts`).

## Контракт v1.0 как есть

Публичные: маршруты `ai/v1/*`, формат токена и scopes, `AGENT_TOOLS`, ссылки `orion://open?type=&id=&workspace=`.
Перечни `AGENT_TOOLS`, `AGENT_SCOPES` и `capabilities` закрыты и живут в ядре.

## Целевое состояние

Компонент объявляет свои инструменты и разрешения в манифесте; `/ai/v1/context` формируется из реестра включённых
компонентов с версиями схем входа и выхода; scope'ы выводятся из словаря [PERMISSIONS.md](PERMISSIONS.md); тесты
«инструмент ↔ маршрут» сохраняются. Все маршруты `/ai/v1/*` проходят единую обёртку scope → режим → лимит → аудит.

## Инструменты подключаемых модулей (G13, частично)

Модуль, подключённый манифестом, объявляет инструменты в `module.manifest.json` → `agent.tools` (имя `orion_<модуль>_<действие>`,
`op` ∈ `read | create`, HTTP-маршрут `/ai/v1/<модуль>/…`, JSON-схема входа) и `agent.controller` (его собственный контроллер).
`pnpm module-registry` выводит `GENERATED_AGENT_TOOLS` (в `AGENT_TOOLS` после инструментов ядра) и `GENERATED_AGENT_CONTROLLERS`;
правок ядра не нужно — образец Pet Care (`apps/api/src/modules-ext/pet-care/pet-care.agent.controller.ts`).

- **Разрешение** инструмента выводится из реестра: `<модуль>.<основной ресурс>.<op>` (`pet-care.pet.create`). Закрытый `AGENT_SCOPES`
  не расширяется: токену такие разрешения выдаются полем `modulePermissions` при выпуске (`POST agent-tokens`); сервер принимает
  только объявленные манифестами (400 на остальное). В БД они лежат в той же колонке `agent_tokens.scopes`, миграции нет.
- **Решение** — `decideAgentModuleOperation`: разрешение выдано → режим (наблюдатель не пишет) → модуль включён (409) → лимит записи (429) →
  журнал (`module`, `objectType`, `objectId`). Всё это — `AgentModuleToolsService.run`, контроллер модуля передаёт только имя инструмента.
- **Контекст:** `GET /ai/v1/context` отдаёт `moduleTools` — инструменты, доступные токену прямо сейчас; модуль попадает в `modules`.
- Тесты: «инструмент ↔ маршрут» учитывает контроллеры модулей; `pet-care-agent.integration.test.ts`.

## Не сделано

Мастер подключения агента и экран токенов не показывают `modulePermissions` (выдача — через API); `op: update` и «запрос на
подтверждение» для инструментов модулей, фильтр по проектам (`allowedProjectIds`) для данных модулей; версии схем входа/выхода
инструментов; scope'ы ядра не выводятся из реестра; режимы автономности и лимиты ТЗ-03 для `capture`/`links` (ADR-0018, «Не сделано», G14);
удалённый доступ — [ADR-0017](../adr/ADR-0017-agent-remote-access.md) (предложение, кода нет); конфигурация ИИ-разработчика
(сценарий Б, PLATFORM.md §6).

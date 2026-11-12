# 09 — Agent Hub 2.0: оркестрация, Trace, Memory (backend)

**Зона ответственности:** `apps/api/src/ai/**` (agent-hub части),
`apps/api/src/mcp/**` (точечно), Prisma-блок `BEGIN 09`, миграции, тесты.
**Волна:** 2. **Никакого фронтенда.**
Локальные документы: `docs/AGENT_HUB_ARCHITECTURE.md`,
`docs/AGENT_CONNECT_SOL_HANDOFF_20261103.md`, `adr/ADR-0047-agent-connection-owner-control.md`,
`adr/ADR-0046-development-workspace-overview.md`, `docs/extensions/AGENT_TASK_ASSIGNMENT.md`.

## Контекст

Уже есть (не ломать!): профили агентов `AgentHubAgentProfile` + credentials,
`AgentHubExecution` (долговременные исполнения), `AgentHubEvent`,
`AgentHubRuntimeSession` (аренда runtime, ручная очередь задач),
`AgentHubTaskAssignment`, безопасное подключение (token-file, loopback handshake,
owner-only admin, аудит продления срока — PR #96, ADR-0047), AI Bridge
(`AssistantKey`, `AssistantConversation`, `AgentMessage`, `AgentAuditEntry`).
Harness поверх Agent Hub **не накладывать отдельной системой** — развивать
существующие модели.

## Задачи

### 9.1. Оркестрация и делегирование

- Родительские/дочерние поручения: `AgentHubExecution` получает `parentExecutionId`
  + `delegationDepth` (лимит, default 3, настраивается владельцем) + запрет
  циклов делегирования (A→B→A).
- Состояния исполнения: явная машина состояний
  `queued → running → waiting_approval → done | failed | cancelled | reassigned`
  (миграция существующих статусов), переходы — только разрешённые, с
  записью `AgentHubEvent` на каждый переход; отмена и переназначение —
  отдельные операции с audit.
- Передача контекста между исполнителями: payload поручения (structured:
  задача, связанные материалы — ссылки через EntityLink, ограничения прав)
  + summary результата родителю при завершении дочернего.

### 9.2. Agent Harness / Trace View (данные)

- Формализовать `AgentHubEvent`: типы шагов `tool_call | tool_result | delegation |
  approval_wait | note | error` + payload-схемы (zod), `stepId`, `parentStepId`
  (дерево шагов), длительность, ошибка/повтор.
- Timeline API: `GET /agent-hub/executions/:id/trace` — flat-лента и
  древовидный вид (по parentStepId), фильтры по типу/шагу/агенту; переход
  «от общего графа к подробностям шага» — один endpoint с depth-параметром.
- Фактические действия только: внутренние рассуждения моделей не фиксировать
  и не пытаться восстанавливать (явное требование плана).

### 9.3. Agent Memory

- `AgentMemoryRecord`: scope (`user | project | agent | global`), ключ, значение
  (jsonb), происхождение (source: agent|user|system), provenanceEventId?
  (ссылка на событие/исполнение), актуальность (`valid | superseded | outdated`),
  supersededById для цепочек пересмотра.
- Контекст перед запуском: `POST /agent-hub/context` — сбор memory по scope
  исполнения + публичные контракты модулей (capabilities), лимиты размера,
  пометка outdated/superseded с просьбой перепроверить.
- Права: запись в memory проекта — исполнителю этого проекта; пользовательская
  memory агента недоступна другим агентам; аудит чтения/записи через
  `AgentAuditEntry`.

### 9.4. Контроль опасных операций

- Продолжение существующего fail-closed: операции с правами выше read-only из
  исполнения — через `waiting_approval` (явное подтверждение владельцем);
  scope-ceiling (beta.36) не расширять без ADR.

## Критерии приёмки

1. Делегирование A→B→A отклонено; глубина сверх лимита отклонена; оба — с
   понятными ошибками (интеграционные тесты).
2. Trace собирает дерево шагов по реальному исполнению с tool_call/tool_result
   парами и approval_wait; фильтры работают (тест).
3. Memory: запись другим агентом в чужую user-memory запрещена (403); superseded
   цепочка сохраняет историю (тест).
4. Существующие интеграционные тесты Agent Hub (21 сценарий) — зелёные
   без изменений ожиданий; проверки из `00-README.md` зелёные; миграции с нуля PASS.
5. Отчёт-блок в `docs/STATUS.md`.

## Out of scope

Фронтенд Hub/Trace UI, Habitat host (.NET), новая агентная шина (использовать
существующую), автоматическое назначение заданий, сторонние LLM-интеграции,
смена модели подключения токенов (ADR-0047).

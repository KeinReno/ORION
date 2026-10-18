# Event API (G3) — спецификация

Статус: **спецификация, кода нет.** Решение о механизме — [ADR-0019](../adr/ADR-0019-event-api-outbox.md) (предложено).

## Как сейчас (v1.0, зафиксировано)

Серверной шины доменных событий нет. Что есть:

- **Триггеры БД `sync_changes`** для `lists`/`list_items`/`notes`/`tasks` — для гибридной синхронизации, не для подписчиков
  (`apps/api/src/sync/hybrid-sync.service.ts`, ADR-0016).
- **Cron-службы** (`@Cron`): `notifications/due-task-checker.service.ts`, `events/event-reminder.service.ts`,
  `events/calendar-connections.service.ts`, `finance/recurring/recurring-checker.service.ts`,
  `contacts/contact-reminders.service.ts`, `search/reminder-checker.service.ts`, `documents/document-trash-purge.service.ts`,
  `notes/note-trash-purge.service.ts`, `sync/sync-maintenance.service.ts`.
- **Аудит, не шина:** `agent_audit_entries`, `TaskActivity` (`tasks/tasks.service.ts`).
- **Клиент:** `apps/web/lib/panel-bus.ts` (pub/sub панелей), `apps/web/lib/cross-window-sync.ts`.
- **Паттерн идемпотентности, который уже работает:** `Notification.eventKey` + частичный уникальный индекс
  `(recipientId, eventKey)`; `NotificationCenterService.createTx` вставляет через `createMany({ skipDuplicates: true })`
  (`apps/api/src/notifications/notification-center.service.ts`, около строки 236) — не `create` + catch `P2002`, потому что
  нарушение уникальности внутри транзакции Postgres даёт `25P02`. Примеры ключей: `task_due:<taskId>`
  (`due-task-checker.service.ts:122`), `event_reminder:<eventId>:<occurrenceStart>:<offset>` (`event-reminder.service.ts`).
  Тот же принцип «барьер в БД» описан в `CLAUDE.md` для `RecurringCheckerService` и `InboxService.process`.
- **Единственный межмодульный «хук» сегодня:** `CapabilityLifecycle` (`apps/api/src/common/capability-lifecycle.ts`) —
  синхронные обработчики включения/выключения модуля/плагина внутри той же транзакции; не события данных.

## Целевое состояние

### Конверт события

```jsonc
{
  "id": "uuid",                     // идентификатор события; ключ идемпотентности потребителя
  "type": "tasks.task.closed",      // <module>.<entity>.<verb>, прошедшее время: created|updated|closed|deleted|...
  "version": 1,                     // версия схемы payload этого type (целое, растёт при breaking-изменении payload)
  "workspaceId": "uuid",
  "actorId": "uuid | null",         // пользователь-инициатор; null для cron/системных
  "occurredAt": "ISO-8601",
  "payload": { }                    // zod-схема в shared-types; только id и минимум полей, без секретов и тел заметок
}
```

`module` в `type` — id модуля из `ORION_MODULE_IDS` (для календаря — `calendar`). Схема каждого `type@version` —
zod в `packages/shared-types` (по правилу CLAUDE.md: контракт живёт там); публикация валидирует payload.

### Доставка: transactional outbox

- `EventBus.publishTx(tx, event)` пишет строку в таблицу outbox **в той же транзакции Postgres**, что и изменение данных
  (внутри `PrismaService.withUser`). Откат транзакции откатывает событие; закоммиченная запись без события невозможна.
- Диспетчер (фоновая служба, `asSystem`) выбирает необработанные строки `FOR UPDATE SKIP LOCKED` и создаёт доставки
  по подписчикам из реестра. Порядок гарантируется только внутри одного `(workspaceId, источник)` по `occurredAt, id`;
  глобального порядка нет.
- **At-least-once.** Потребитель обязан быть идемпотентным: ключ — `(eventId, subscriberId)` (уникальный индекс таблицы
  доставок) и/или собственный `eventKey` по образцу уведомлений (`<kind>:<id>`), вставка через `createMany`
  с `skipDuplicates`. Повтор после сбоя — с экспоненциальной паузой и лимитом попыток; исчерпание → статус `failed`
  и запись в диагностику (связано с G9), публикация не страдает.
- Таблицы outbox и доставок — workspace-таблицы с `ENABLE`+`FORCE ROW LEVEL SECURITY` (структурный тест
  `api-rls.integration.test.ts` это проверит); в `SNAPSHOT_MODEL_REGISTRY` — `ephemeral-excluded`; в `SYNC_CLASSIFICATION` — `not-synced`.
  Хранение: доставленные строки чистятся по расписанию (предложение — 7 дней).

### Права и RLS при доставке

- Публикует только код, уже прошедший `assertMember`/`@RequireModule`/RLS; событие несёт `workspaceId` и никогда — чужие данные.
- Диспетчер идёт через `asSystem` (как все фоновые задачи, CLAUDE.md), но обработчик подписчика обязан сам применить
  права получателя так же, как `NotificationCenterService.createTx`: членство, доступность модуля получателю
  (`accessibleSetTx`), политика `NotificationPolicyService.allowsForUser`. Действия по инициативе пользователя,
  пишущие адресные строки (например, уведомление), идут через `asSystem` отдельной транзакцией — иначе RLS отклонит (`42501`).
- Подписка требует разрешения на чтение соответствующих данных: `events.subscribes` в манифесте сверяется с
  `permissions` компонента (см. [PERMISSIONS.md](PERMISSIONS.md)); подписка без права на чтение сущности отклоняется при регистрации.

### Объявление в манифесте

Поля уже есть в схеме (`packages/shared-types/src/component-manifest.ts`): `events.publishes: string[]`,
`events.subscribes: string[]` — сегодня пусты. Целевое значение — список `type`; версию при необходимости
указывать как `tasks.task.closed@1`. Реестр подписчиков собирается из манифестов включённых компонентов.

### Если подписчик (модуль/плагин) выключен

- Публикация **не падает и не ждёт** подписчиков: источник знает только outbox.
- Для выключенного в пространстве подписчика (`Workspace.disabledModules`, `pluginOverrides`) доставка помечается
  `skipped_disabled` и не повторяется; события не воспроизводятся при последующем включении (иначе включение
  вызвало бы лавину устаревших реакций). Если нужна догонка — это явный запрос компонента к своему источнику данных.
- Если выключен **издатель** — событий нет: его контроллеры отвечают 409 (`@RequireModule`), cron-службы пропускают
  пространство (`pluginOffWhere`).

### Первые события и связь, которую каждое заменит

| Событие | Издатель | Прямая связь сегодня, которую заменит |
|---|---|---|
| `tasks.task.created` | `TasksService.createTx` (`apps/api/src/tasks/tasks.service.ts:93`) | Нет прямой связи; нужен календарю/проектам/плагинам без чтения таблицы задач (аудит §3.14: `CalendarPanel` читает `useTasks`). |
| `tasks.task.updated` | `TasksService.update` | Запись `TaskActivity` в том же сервисе остаётся (это аудит); событие — для подписчиков. |
| `tasks.task.closed` | `TasksService.update` при переходе «открыта → закрыта» (`closedNow`) | `tasks.service.ts:237-246`: сервис задач сам читает/обновляет `tx.timeEntry`, останавливая таймер. Заменится подпиской модуля `time`. |
| `tasks.task.overdue` | `DueTaskCheckerService` | `due-task-checker.service.ts:122`: прямой `notifications.createTx` + Telegram; потребитель — центр уведомлений. |
| `tasks.comment.created` | `TaskCommentsService` | `task-comments.service.ts:103-112`: прямой вызов `notifications.createTx` через `asSystem`. |
| `calendar.event.reminder_due` | `EventReminderService` | `event-reminder.service.ts:72`: прямой `createTx` + Telegram + запись `sentReminder`. Дедуп-леджер издателя остаётся. |
| `notes.note.created` | `NotesService.createTx` (`apps/api/src/notes/notes.service.ts:226`) | Прямой связи для замены не найдено; нужно плагинам заметок (`notes-daily`, `notes-history`) и индексам без правки ядра. |
| `finance.obligation.due` | новый шаг службы финансов по `FinanceObligation.nextDueAt` | Издателя-крона для обязательств в коде не найдено (проверено по `apps/api/src/finance/obligations/`); сегодня их читает `home.service.ts:118` напрямую. Нужно целям (аудит §2 PLATFORM.md, «обязательства → цели») и уведомлениям. |

Payload каждого — минимум: `{ id, projectId?, homeId?, status? }` и т. п.; точные схемы — при реализации, в `shared-types`.

## Не сделано

Таблицы outbox/доставок и миграция; `EventBus`/диспетчер; схемы событий в `shared-types`; реестр подписчиков из манифестов;
политика повторов и диагностика; интеграционный тест G3 (издатель A → подписчик-плагин B, выключенный B не ломает
публикацию, повтор идемпотентен, RLS не обходится); перенос первого потребителя (рекомендуется: `tasks.task.closed` → `time`).
Клиентская шина (`panel-bus.ts`) не затрагивается.

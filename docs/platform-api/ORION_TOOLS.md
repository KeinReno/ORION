# Orion Tools: таблицы, команды и горячие клавиши

Задание 10. Это **общие инструменты платформы** (поверхность ядра), а не
предметные модули: у них нет записи в `MODULE_CATALOG`, их нельзя выключить
флагом пространства, и они не появляются в списке модулей настроек. Данные
таблиц при этом workspace-scoped и проходят те же проверки, что у модулей:
членство, `withUser`-транзакция, RLS.

Состояние: реализовано (11.11.2026). Фронтенд не входит в задание.

## Orion Tables

| Что | Где |
|---|---|
| Контракт, формулы, CSV | `packages/shared-types/src/table.ts` |
| API | `apps/api/src/tables/` |
| Модели | `TableDefinition`, `TableRow` (`apps/api/prisma/schema.prisma`, блок `10-orion-tools`) |
| Миграция | `20261111193000_orion_tools_tables_key_bindings` |
| Событие | `table.row_changed` (`DOMAIN_EVENT_CATALOG`, publisher `core`) |
| Права | `core.table.read/create/update/delete` |

### Маршруты

```text
GET    workspaces/:id/tables                     список (без строк, с rowCount)
POST   workspaces/:id/tables                     создать таблицу
GET    workspaces/:id/tables/:tableId            таблица + строки + итоги формул
PATCH  workspaces/:id/tables/:tableId            имя и/или схема колонок
DELETE workspaces/:id/tables/:tableId            удалить (строки каскадом)
POST   workspaces/:id/tables/:tableId/rows       добавить строку
PATCH  workspaces/:id/tables/:tableId/rows/:rowId  заменить значения строки
DELETE workspaces/:id/tables/:tableId/rows/:rowId  удалить строку
PUT    workspaces/:id/tables/:tableId/rows/order   ручной порядок (все id)
POST   workspaces/:id/tables/import-csv          CSV → новая таблица
GET    workspaces/:id/tables/:tableId/export.csv CSV (BOM, `text/csv`)
```

### Колонки и значения

Типы: `text | number | date | select | checkbox | url | formula | link`.
Схема проверяется zod-схемой и сервером: `select` требует варианты, `formula` —
формулу, `link` — `linkType` (`task | project`). Лишние поля у колонки
отклоняются, чтобы опечатка не создала колонку без вариантов выбора.

Значения строк проверяет `validateTableRowValues` из `shared-types` по тем же
правилам, что и импорт: `number` — конечное число, `date` — существующая дата
`ГГГГ-ММ-ДД`, `checkbox` — boolean, `url` — только `http(s)`, `select` — один
из вариантов. Значение формульной колонки записать нельзя (вычисляется на
чтении).

`link`-колонки не читают чужие таблицы: существование проверяют публичные
контракты владельцев — `TaskReferenceReader.byIdsTx` для задач и
`ProjectReferences.existsTx` для проектов. Чужой id из другого пространства
даёт 422.

### Формулы

Разбор — `parseTableFormula`, вычисление — `evaluateRowFormula` /
`evaluateAggregateFormula` / `computeTableFormulas`. Две формы:

- агрегат по всей колонке: `sum(amount)`, `avg({amount})`, `count`, `min`, `max`;
- выражение по ячейкам той же строки: `{price} * {qty} + 5` (+ `- * /`, скобки,
  унарный минус).

Чтение возвращает `totals` (значение на агрегатную колонку) и `computed` у
каждой строки (значения строчных формул). Неизвестная функция и ссылка на
несуществующую колонку отклоняются **422** при записи схемы; формула не может
ссылаться на формулу (скрытая рекурсия), это тоже 422.

Смена схемы над данными проверяет каждую строку по новым типам: несовместимая
строка — 422 с номером строки, а не тихое обнуление.

### CSV

Импорт: `{ name, csv, columns: [{ id, name, type, options?, linkType?, sourceHeader }] }`.
`sourceHeader` — явный маппинг колонок: заголовок ищется в первой строке файла
без учёта регистра, а не по позиции. Разделитель (`;` или `,`) определяется по
заголовку. Пустая ячейка — `null`; `checkbox` понимает `true/false/1/0/да/нет`;
`number` — и `12,5`, и `12.5`. Формульные колонки импортировать нельзя (422).

Экспорт: заголовок — названия колонок, формульные колонки выгружаются
вычисленными значениями, BOM добавляется в контроллере.

**Отложено осознанно:** XLSX-экспорт. В `apps/api` нет рантайм-зависимости для
работы с XLSX, а задание прямо запрещает добавлять зависимости без
необходимости. Когда табличный XLSX появится в API-пакете, экспорт добавляется
рядом с `exportCsv` без изменения контракта колонок.

## Реестр команд

| Что | Где |
|---|---|
| Контракт | `packages/shared-types/src/commands.ts` |
| Реестр | `apps/api/src/commands/command.registry.ts` |
| API | `apps/api/src/commands/commands.controller.ts` |
| Команды ядра | `apps/api/src/commands/core-commands.ts`, `apps/api/src/tables/tables.commands.ts` |
| Права | `core.command.read`, `core.command.execute` |

```text
GET  commands?workspaceId=           команды включённых модулей + core
POST commands/:id/execute            { workspaceId, args? }
```

Команда: `{ id, title, module, keywords[], context, permission, run }`, где
`run` — либо `{ kind: "server", operation }`, либо `{ kind: "ui", route }`.
Серверная команда исполняется зарегистрированным обработчиком; UI-команда
возвращает `{ kind: "instruction", route }` — маршрут исполняет клиент, сервер
не притворяется, что умеет открывать панели.

Видимость решает `ModulesService.accessibleSetTx` — тот же чекпойнт, что у
`@RequireModule`: выключенный модуль не отдаёт свои команды, ограниченный
(`restrictedModules`) не отдаёт их обычному участнику. Исполнение скрытой
команды — 404 (неразличимо с несуществующей). Регистрация команды с
незарегистрированным разрешением падает при старте, а не в рантайме.

## Горячие клавиши

| Что | Где |
|---|---|
| Контракт | `commands.ts` (`normalizeKeyBinding`, `keyBindingConflicts`) |
| API | `apps/api/src/commands/key-bindings.controller.ts` |
| Модель | `KeyBinding` (RLS, уникальность `workspaceId+userId+commandId`) |
| Права | `core.key_binding.manage`, чтение — `core.command.read` |

```text
GET    workspaces/:id/key-bindings           { bindings, conflicts }
POST   workspaces/:id/key-bindings           { commandId, keys, scope? }
PATCH  workspaces/:id/key-bindings/:id       { keys?, scope? }
DELETE workspaces/:id/key-bindings/:id
```

`scope`: `global | module:<id> | context:<id>`. `global` пересекается со всеми,
`module:x` — только с `module:x`, `module:x` и `context:y` не конфликтуют.
Сочетание нормализуется (регистр, порядок модификаторов, `cmd → meta`), иначе
`Ctrl+Shift+K` и `shift+ctrl+k` не считались бы конфликтом.

Конфликт — **предупреждение, а не блокировка**: `POST`/`PATCH` возвращают
`{ binding, conflicts }`, конфликты видны и в `GET`. 409 отдаётся только за
повторное сочетание одной и той же команды (уникальный индекс). Привязки
личные: `userId` входит в каждый запрос и уникальный ключ, чужие не видны.

## Отложено / ограничения

- XLSX-экспорт (см. выше).
- Синхронизация таблиц между устройствами поверх Sync Core — вне задания.
- Плагины-хранилища таблиц, SQL-режим — вне задания.
- Link-колонки первой срез поддерживают задачи и проекты; новый тип = адаптер
  на публичном контракте владельца, а не прямой запрос в его таблицы.

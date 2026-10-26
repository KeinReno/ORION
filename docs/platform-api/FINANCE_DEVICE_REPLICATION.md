# Finance device replication v1

Статус: реализован серверный срез, 26.10.2026. Решение —
[ADR-0035](../adr/ADR-0035-finance-device-replication.md).
Проверки — [отчёт](../android/FINANCE_SERVER_V1.md).
Android adapter/кэш/outbox/UI ещё не реализованы; действующий APK остаётся alpha.26.

## Владение и подключение

Контроллерless SDK: `apps/api/src/finance/public/device-replication.ts`,
`device-replication.module.ts`. Token `FinanceDeviceReplication` предоставляет
`capability(userId, workspaceId)`, `snapshot(userId, workspaceId, deviceId)` и
`command(userId, workspaceId, FinanceDeviceCommand)`.
SDK сам открывает исходную RLS-транзакцию и проверяет полномочия; вызывающий
код не может подменить чужой transaction/user через SDK-аргумент.

Опциональный API adapter: `apps/api/src/finance-device-sync/`, компонуется
AppModule, не импортируется Finance Base. Плагин `finance-device-sync` выключен
по умолчанию. Все пути требуют включённых Finance/plugin, членства, hybrid-mode.
Snapshot и commands также требуют зарегистрированного неотозванного SyncDevice
текущего пользователя. Read guards соседних модулей используют controllerless
`ListExpenseReferences` и `HomePaymentReferences` в исходном tx/RLS; Finance
не читает внутренние таблицы соседей.

## HTTP

Префикс: `/workspaces/:workspaceId/finance/device-sync/v1`.

| Метод/путь | Назначение |
|---|---|
| GET capability | `{capability:"finance.device-sync.v1",protocol:1,snapshot:"full"}` |
| GET snapshot?deviceId=UUID | Полный согласованный снимок доступных счетов/категорий/операций с ревизиями |
| POST commands | Одна create/update/delete команда; 201 с сохранённым результатом, в том числе при повторе |

Wire schemas — `packages/shared-types/src/finance-device-sync.ts`.
Пример команды (синтетические UUID):

```json
{
  "protocol": 1,
  "kind": "create",
  "deviceId": "00000000-0000-4000-8000-000000000001",
  "opId": "00000000-0000-4000-8000-000000000002",
  "entityId": "00000000-0000-4000-8000-000000000003",
  "input": {
    "accountId": "00000000-0000-4000-8000-000000000004",
    "categoryId": "00000000-0000-4000-8000-000000000005",
    "type": "expense", "amount": 12050,
    "occurredAt": "2026-10-26T09:00:00.000Z", "note": "Пример"
  }
}
```

`update` передаёт полный input и `expectedRevision`; `delete` — только envelope
и expectedRevision. authority-поля user/workspace, неизвестные поля, transfer,
дроби и сумма вне1..2147483647 копеек отклоняются. V1 пишет только RUB в уже
существующий активный счёт и активную категорию соответствующего типа.
Не создаёт счета, не меняет visibility, не импортирует локальные деньги.

Ответ: `{protocol,opId,entityId,outcome:"applied"|"deleted",revision}`. Он минимален:
повтор квитанции не возвращает старое приватное содержимое. Replay identity —
user/workspace/device/opId, body hash вычисляет сервер. Повтор того же нормализованного
тела возвращает исходный ответ; иной body —409 `op_body_mismatch`.
Receipt и деньги фиксируются атомарно, receipt не истекает автоматически.

409 `revision_conflict` требует заново загрузить снимок и предложить пользователю
решение, сохранив его draft. Нельзя менять expectedRevision и повторять без решения.
404 означает удалённую/недоступную запись или ссылку; 403 — нет полномочий/устройства.
409 также используется для read_only_transaction, operation_conflict, entity_exists,
unsupported_currency, concurrent_write и несовместимого режима/выключенного plugin.
При concurrent_write можно повторить ту же команду с тем же opId после обновления
копии; нельзя создавать новый opId ради обхода конфликта.

## Ревизии и согласованность

FinanceDeviceVersion — отдельная RLS-таблица, не изменение старого Transaction DTO.
DB triggers увеличивают revision при каждом header/line write, включая перенос
строки между двумя операциями (меняются обе ревизии). DELETE оставляет tombstone.
SDK резервирует уникальный entityId до create; даже скрытый tombstone после
удаления личного счёта препятствует повторному созданию под другим счётом.

Команды блокируют config/device и canonical header/version в исходной транзакции;
legacy desktop update и FK-ссылки сериализуются с проверкой CAS/read-only.
Transfer/split/reconciled/imported/recurring/tagged/project-linked и известные
Lists/Home/Investment ссылки не редактируются этой упрощённой формой.

Snapshot читается под REPEATABLE READ и содержит `complete:true`, snapshotId,
asOf, accounts с owner/visibility/balance, categories и
`{transaction,revision,editable}`. Ответ включает только операции, оба счёта
которых видимы текущему пользователю. Превышение1000 счетов/5000 категорий/
10000 операций/8MiB возвращает413, а не усечённый authoritative snapshot.
Текущий v1 не имеет incremental cursor: успешный полный ответ заменяет только
свой remote scope; отсутствие строки означает удаление/потерю доступа.

## Миграция и хранение

`20261026180000_finance_device_replication`: добавляет только metadata, backfill
ревизий и triggers. Старые финансовые строки/суммы не переписываются.
Обе таблицы имеют ENABLE + FORCE RLS, private-account фильтры. Минимальная
metadata trigger function — SECURITY DEFINER с фиксированным search_path,
без параметров/dynamic SQL; public EXECUTE отозван. Это нужно для account cascade.

Ledger/version исключены из переносимого snapshot и hybrid protocol1, привязаны
к узлу и identity. На исходном узле не удалять их при выключении plugin/откате
бинарника. Удаление схемы после реального использования уничтожает защиту от
повторов; обычный rollback бинарника должен оставить эту аддитивную схему.

## Следующий клиентский срез

Negotiation до изменения finance UI; native allowlist только этих путей;
отдельные scoped SQLite replica/outbox, атомарный cache replace; выбор счёта ПК,
offline очереди/conflict UI, сохранность старого phone-local snapshot/drafts.
Отсутствие capability/выключенный plugin не разрешает fallback на обычный POST.
После этого — совместимые Windows/APK пакеты и физическая двусторонняя приёмка.

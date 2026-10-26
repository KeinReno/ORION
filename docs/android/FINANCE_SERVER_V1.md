# Финансы: серверный канал устройств v1

Статус: HISTORICAL / серверный срез, 26.10.2026. Исходный HEAD 46b44f2 плюс
изменения этого отчёта; точная ревизия — commit данного набора изменений.
Направление — [PLATFORM](../PLATFORM.md), текущие факты — [STATUS](../STATUS.md).
Решение — [ADR-0035](../adr/ADR-0035-finance-device-replication.md),
API/SDK — [контракт](../platform-api/FINANCE_DEVICE_REPLICATION.md).

## Сделано

- Отдельный default-off plugin `finance-device-sync` и capability
  `finance.device-sync.v1`. AppModule компонуется с API adapter; Finance Base
  его не импортирует. Старый hybrid protocol1/entity set сохранён.
- Controllerless FinanceDeviceReplication SDK, capability/full snapshot/commands
  endpoints. Снимок REPEATABLE READ, команды в одном tx/RLS. Общий withUser
  получил необязательный isolationLevel; старые вызовы не меняют поведения.
- Атомарные durable receipts, server-computed body hash, отдельные advisory
  locks для opId и entityId. Повтор одной команды подтверждается прежним ответом;
  другой body с тем же opId отклоняется. Конфликт revision не становится LWW.
- Metadata revisions/tombstones на PostgreSQL triggers: header, line и перенос
  line между двумя операциями отслеживаются для всех старых путей записи.
  Уникальная reservation до create защищает даже скрытый tombstone после
  удаления личного счёта. Receipt/version не экспортируются в чужую identity.
- FORCE RLS для metadata, проверка account visibility при replay, текущие
  membership/module/plugin/hybrid/device gates и блокировки config/device.
  Read-only protection для сложных и известных связанных расходов; соседние
  Lists/Home читаются только через новые purpose-specific public ports.
- Existing TransactionsService create/update выделены в tx-методы без отдельной
  финансовой логики. Обычные API сохраняют validation, alerts и DTO.
  Суммы/балансы не передаются как произвольная sync-команда.

## Проверено локально

Windows, PostgreSQL на5433; использовались только отдельные базы
`orion_finance_device_20261026_r1` и `orion_finance_device_e2e_r1`.
Рабочая база/профиль Windows на55432, телефон и их деньги не мигрировались.

- **1602 unit tests /210 files** прошли. Первый общий прогон нашёл устаревший
  generated platform map и две проверки классификации новых metadata models;
  map пересоздан, обе модели явно classified not-synced. После исправления
  полный прогон повторён успешно.
- **46 PostgreSQL/HTTP integration tests /6 files**, включая18 новых Finance
  device сценариев и регрессии private accounts/import/scale/transfer-match/
  старого hybrid sync. Четыре concurrent identical commands создают одну
  операцию и один эффект на баланс. Проверены revision конфликт после desktop
  header и прямого line write, concurrent edit/edit, delete/replay/tombstone,
  hidden tombstone reuse, invalid refs rollback/no receipt, private snapshots/
  receipt visibility, потеря membership, чужое/отозванное устройство, module/
  plugin/mode off, неподдерживаемая валюта/суммы и linked read-only.
- Opt-in migration acceptance включена только для выделенной fixture-БД:
  metadata временно пересоздаётся внутри одной admin-транзакции на заполненных
  финансовых таблицах. Проверены неизменность header/lines, backfill всех
  существующих операций и rollback DDL с восстановлением прежнего receipt.
  Guard требует FINANCE_MIGRATION_ACCEPTANCE=1 и fixture database name.
- Workspace typecheck и профильный lint прошли. Architecture/plugin-contract,
  module-docs/platform-map проверки прошли; публичные пути внесены генераторами.
- Production API/web build прошли. Два Chromium smoke сценария Finance:
  default-full и plugins-off — прошли на отдельных API4481/web3181.
  Windows native installer/телефонный финансовый интерфейс здесь не проверялись.

## Изменённые области

`packages/shared-types`: отдельные schemas/exports/plugin manifest и2 contract tests.
`apps/api/prisma`:2 metadata models и аддитивная миграция.
`apps/api/src/finance`: SDK, серверный adapter service, tx-domain commands.
`apps/api/src/finance-device-sync`: optional endpoint composition.
`lists/public` и `home-utilities/public`: read-only references в исходном tx.
`common/prisma.service`: опциональная snapshot isolation.
`sync`: явная backup/hybrid classification metadata; доменный протокол не изменён.
Tests, ownership map, generated module/capability docs и нормативный ADR/API.

## Что пока не включено

Это готовый для подключения клиента серверный срез, не end-to-end финансовая
синхронизация. Действующий Android alpha.26 не вызывает новый канал и по-прежнему
хранит финансы локально. Рабочий Windows beta.25 не обновлён этой серверной
сборкой. Новый APK/installer не публиковались: миграцию рабочего профиля выполнять
вместе с клиентским срезом после отдельной приёмки и резервной копии.

Первый writable API — простые RUB income/expense в существующие счёт/категорию;
сложные операции read-only. Нет cursor/delta, создания счетов/категорий, локального
импорта, phone SQLite outbox и conflict UI. Локальные деньги не публикуются сами.
Включение plugin не переносит ничего и не делает private счета общими.

Следующий кодовый срез: negotiation/native allowlist, отдельная scoped durable
Finance replica/outbox, выбор счёта ПК в Android, offline queue/conflict UI,
проверка сохранности старого локального snapshot и физический phone→PC→phone.
Пакеты Windows/APK выпускать после проверки на общей совместимой паре версий.

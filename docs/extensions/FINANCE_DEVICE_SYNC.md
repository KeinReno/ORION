# Finance device sync — Extension Proposal

Статус: PROPOSED, 26.10.2026, исходный HEAD 36946e4. Основание: поручение
владельца продолжить восстановление связи, затем двустороннюю синхронизацию
финансов. Это проект следующего среза, не утверждение о работающей синхронизации.

Обновление 26.10.2026: серверный срез реализован по
[ADR-0035](../adr/ADR-0035-finance-device-replication.md) и
[публичному SDK](../platform-api/FINANCE_DEVICE_REPLICATION.md). Первое чтение —
полные bounded snapshots, incremental cursor отложен. Изменения/удаления
отслеживаются отдельными DB revisions/tombstones. Android/UI и физическая
финансовая синхронизация остаются следующими шагами; этот исходный proposal
сохраняется как обоснование и не переопределяет более точный ADR/SDK.

`NEW_EXTENSION_POINT_REQUIRED`: Finance не входит в текущий hybrid protocol1;
нельзя включить деньги в hardcoded task/note merge или напрямую импортировать
внутренний TransactionsService в Core Sync. До server code нужен принятый ADR
версии/миграции и публичный Finance replication SDK / зарегистрированный adapter.
Это требование архитектуры, не запрос повторного разрешения владельца на работу.

## Проверенные исходные границы

- `shared-types/hybrid-sync.ts`: только list/listItem/note/task в snapshot и
  offline write set. Старый Windows beta.25 не объявляет финансовую capability.
- Finance владеет Account, FinanceCategory, Transaction и TransactionLine;
  `finance/MODULE.md` и `AI_CONTEXT.md` требуют withUser/RLS и проверки ссылок.
- `accounts.service.ts` устанавливает ownerId создателя; private-account доступ
  ограничивает БД. Нельзя превращать локальные ownerId=null в общий счёт.
- `transactions.service.ts` create не принимает idempotent device op; update
  заменяет строки операции и не требует expectedRevision. Нельзя безопасно
  повторять обычный POST после сетевого таймаута или считать PATCH разрешением
  конфликтов. `importedRef` предназначен для импорта, не замена sync receipt.
- Account.balance вычисляется по startingBalance и операциям. Не передавать
  balance как команду и не считать optimistic total подтверждённым балансом ПК.
- Локальный Android использует UUID, целые копейки RUB, accounts/categories,
  transactions и draft в одном durable snapshot. Имена не являются identity.

## Первый рабочий срез

1. Публичный FinanceDeviceReplication SDK, владелец Finance; зарегистрированная
   optional capability `finance.device-sync.v1` и отдельный versioned endpoint.
   Core владеет транспортом/receipt, Finance — проверкой и проведением денег.
   Выключенный Finance/capability не ломает Tasks/Notes/Lists и не удаляет деньги.
   Старый сервер отвечает unsupported: Android оставляет локальные финансы,
   не пытается обходить отсутствие capability обычным CRUD POST.
2. Снимок в одной RLS-транзакции: доступные accounts (с owner/visibility),
   categories, transactions с lines, cursor и server token. Сначала download,
   затем offline income/expense в выбранный существующий доступный счёт ПК.
   Transfers/splits/recurring/reconciled rows доступны read-only, пока полный
   редактор не умеет сохранить все поля; не уплощать их в одну строку.
3. Команда: protocol, opId UUID, deviceId, workspaceId, entityId UUID,
   kind create/update/delete, expectedRevision для update/delete, bodyHash,
   валидированный полный transaction input. Суммы — safe integer копеек,
   положительные, валюта счёта; occurredAt + дата сохраняют выбранный день.
   Не вводить LWW для денег или подтверждать операцию только по локальной дате.
4. Receipt + command + domain write + change/tombstone фиксируются атомарно.
   Unique receipt: user/workspace/device/opId; повтор того же body возвращает
   прежний результат, другой body с тем же opId — conflict, не второй расход.
   Receipt/tombstone живёт дольше допустимой offline-очереди; истёкшая очередь
   требует восстановления/подтверждения, не считается новым create.
5. Ревизия: добавить monotonic revision для Transaction; ВСЕ пути записи
   (desktop CRUD, import, recurring, transfer-match, integrations) увеличивают
   её и публикуют change в исходной транзакции. Без этого offline CAS фиктивен.
   Конкурентное изменение возвращает обе версии для решения пользователем;
   Android хранит исходную команду и draft до подтверждения.
6. Кэш и outbox scoped по nodeId/fingerprint/userId/workspaceId/capability.
   Нельзя показывать кэш под другим пользователем. Permission loss/revocation
   не подтверждает pending, не открывает private data соседям и очищает отозванную
   remote-копию по принятой политике; phone-local остаётся независимо.

## Личные и общие данные

На телефоне выбор «На телефоне» / именованное пространство ПК; внутри выбора
счёт показывает private/workspace. По умолчанию нет импорта или смены visibility.
Первые synced операции привязываются к счёту, который пользователь выбрал явно.
Локальные «Карта»/«Наличные» остаются локальными, даже если на ПК такие же имена.
Их перенос — отдельный preview после backup: mapping account/category по ID,
количество/суммы/валюта, назначение private по умолчанию, явное подтверждение.
Повторный перенос использует durable ledger, а не дублирует исходные деньги.

## Порядок реализации и приёмка

1. ADR и capability schema; isolated RLS migration с откатом и preservation test.
2. Finance SDK + receipt/CAS/changes в существующих путях записи; реальные
   PostgreSQL tests для двух пользователей и private/workspace счетов.
3. Capability negotiation в Android native allowlist; scoped durable finance
   replica/outbox, без изменения старого snapshot и без автоматического импорта.
4. Finance UI выбранного пространства с offline/pending/conflict состояниями;
   старые local drafts и сложные операции не теряются при навигации/редактировании.
5. Signed-compatible APK и соответствующий Windows installer после проверок.

Обязательные сценарии: create offline → lost ACK → повтор → ровно одна запись
и один эффект на баланс; одновременные edit/edit и edit/delete; scope mismatch;
private счёт другого пользователя; disabled module/plugin; archive/missing
account/category; изменение валюты/даты; восстановление после process death;
resync с tombstones; старый Windows без capability; UI default-full/plugins-off.
Проверки проводят на синтетических данных. Реальный пользовательский перенос
допускается только после preview и отдельного выбора назначения.

Следующий deliverable — ADR + versioned schemas + server receipt/CAS regression;
текущий Android alpha.26 меняет только восстановление сети, не деньги.

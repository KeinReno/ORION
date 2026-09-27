# Архитектура и инварианты реализации

## Сохранить текущий фундамент

```text
Next/Tauri → panel → core-react → core/ApiClient → Nest controller/service
                         ↕ shared-types/Zod ↕
                              Prisma → PostgreSQL/RLS
                                      → StorageAdapter → файлы
```

Не нужны микросервисы, Redux поверх React Query, новая ORM, новый UI-kit или замена dockview. UI не обращается к fetch напрямую; domain DTO не являются Prisma-моделями; React Query хранит серверное состояние, panel state — локальное состояние вида.

## Policy: одна семантика, несколько уровней защиты

Добавить actor-aware методы в текущий ModulesService либо узкий AccessPolicyService, если появляется независимая ответственность. Не создавать универсальный DSL разрешений.

Предлагаемый контракт:

```ts
type AccessContext = { userId: string; workspaceId: string };
// Внутри текущей Prisma-транзакции, membership загружен/проверен.
accessibleModuleIdsTx(tx, context): Promise<Set<OrionModuleId>>;
assertModuleAccessTx(tx, context, moduleId): Promise<void>;
assertWorkspaceRoleTx(tx, context, roles): Promise<Membership>;
```

Существующий enabledSetTx оставить только для системных фоновых операций, где actor отсутствует и это действительно нужно; явно назвать системную семантику. Не использовать его для ответа пользовательскому HTTP-запросу.

Прямой доступ: disabled → 409; restricted → 403; отсутствие членства → принятый в проекте отказ. Агрегатор: недоступный домен вообще не читать и не выдавать. DTO финансовой сводки при отсутствии доступа не должен передавать настоящие значения «на всякий случай». Для UI использовать capability/visibility flags или nullable section с явным состоянием; не подменять скрытую сумму нулём.

Проверять исходную и целевую сущности связей; уведомления фильтровать по актуальному доступу; restore/export — только owner. Вновь добавленная таблица с workspaceId получает ENABLE/FORCE RLS и политики в **той же серии миграций**.

## Данные для полноценной команды

### TimeEntry

Добавить nullable userId для legacy-строк. Новые записи всегда получают текущего actor на сервере. Старые записи не назначать случайному владельцу: показывать «Автор не указан», включать в общие итоги отдельно. userId не должен каскадно удалять финансово значимую историю при удалении пользователя.

Уникальность running: `(workspaceId, userId) WHERE endedAt IS NULL AND userId IS NOT NULL`. Legacy running на миграции не останавливать молча: отдельный отчёт/preflight и детерминированное разрешение владельцем до включения новой логики. Не оставлять старый уникальный индекс workspaceId вместе с новым.

### Notification

Новые notification records адресны: recipientUserId, readAt, eventKey, channel/status в delivery-слое. Точный выбор одной таблицы получателей или отдельных адресных уведомлений описать ADR перед кодом; для v1 рекомендуются отдельные адресные строки с уникальным `(workspaceId, recipientUserId, eventKey)`.

Legacy общая лента остаётся read-only «История пространства» либо архивируется миграцией с явной пометкой. Не клонировать старые readAt как будто каждый участник действительно прочитал запись. Membership/restrictions проверять и при чтении, и перед отправкой.

### Revision и конфликт

Для изменяемого контента в первую очередь Note: integer revision, обновление `WHERE id AND workspaceId AND revision=expectedRevision`, атомарно revision+1. При отсутствии совпадения различать 404/403 и 409. Историю писать только после успешного CAS в той же транзакции. Простое сравнение updatedAt после отдельного SELECT гонку не решает.

Task/Project расширять тем же контрактом после заметок. Не тащить CRDT до появления отдельного требования совместного редактирования в реальном времени.

## Навигационные intent

Сохранить panel-bus как адаптер Workbench, расширить явной структурой:

```ts
type EntityIntent = {
  workspaceId: string;
  panelId: string;
  entityType?: string;
  entityId?: string;
  intentId: string;
};
```

Pending intent хранится до готовности подписчика, применяется ровно один раз, проверяется workspaceId и доступ. Повторный клик создаёт новый intentId. При logout/switch удалить pending intent старого scope. Deep link сериализует только IDs/тип, без содержимого и секретов; загружает сущность сервером после проверки доступа.

Роуты не должны размонтировать весь Workbench. Browser back/forward обновляют intent/active panel через небольшой адаптер. Не менять всю навигационную архитектуру ради ссылок.

## Query cache и фоновые процессы

- Workspace-scoped keys включают workspaceId; user-private keys дополнительно userId.
- Logout отменяет in-flight queries и очищает чувствительный кэш; смена пользователя не использует старые placeholders.
- Изменение роли/модуля инвалидирует capability queries и зависимые данные. Скрытая панель не продолжает показывать старые restricted данные.
- Обновления в фоне не перетирают dirty form.
- Cron idempotency обеспечивается БД/уникальным ключом, не только памятью процесса.
- Сетевые обращения к WebDAV/ICS выполняются вне длинных DB-транзакций; результат фиксируется короткой транзакцией.

## Миграционная дисциплина

1. Добавляющая миграция → backward-compatible DTO → backfill с отчётом → ограничения → удаление старого пути отдельным шагом.
2. Каждый изменённый DTO проходит все четыре клиентских слоя.
3. Snapshot format обновляется одновременно со schema, есть explicit inclusion/exclusion registry.
4. Новые индексы обоснованы запросами и EXPLAIN на синтетических данных, а не общей рекомендацией.
5. Не редактировать применённые миграции; не запускать reset на пользовательской БД.

Технические решения этого файла — engineering coverage gap относительно product-design rules; их проверка — тесты и инварианты, а не визуальные эвристики.

## Дополнение: реестр сущностей и независимый контекст

Применять 23-UNIVERSAL-CONNECTED-CORE: сохранить доменные модели/FK, расширить существующий EntityLink после инвентаризации, унифицировать resolve/picker/actions. Контекст панелей и intents содержит workspace объекта; общий localStorage active-workspace не источник для всех окон. Связи внутри workspace предшествуют cross-space sharing. U09 требует отдельной grant-aware политики; generic links не обходят RLS. Подробные этапы и приёмка — 24.

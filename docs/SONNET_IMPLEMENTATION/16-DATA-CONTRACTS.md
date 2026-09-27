# Данные и контракты: уточнение для исполнителя

## Проверенный снимок покрытия backup

В Prisma-схеме аудита найдено **38 моделей с workspaceId**; в SNAPSHOT_MODELS — **27**. Разность не означает автоматически 11 дефектов: часть identity/secrets/ephemeral данных должна исключаться намеренно. Но исключение обязано иметь явно определённое поведение при restore.

| Модель вне SNAPSHOT_MODELS | Предложенная политика |
|---|---|
| InventoryItem | included, добавить |
| InventoryMovement | included, добавить после item |
| Milestone | included, добавить после project, до tasks |
| MilestoneDependency | included после milestones |
| DocumentVersion | included metadata + immutable bytes |
| DocumentAnnotation | included, даже если UI пока не завершён |
| WorkspaceMember | identity-excluded из data snapshot; membership текущего workspace сохранить |
| WorkspaceInvite | secret/identity-excluded; не воскресить старые invite tokens |
| SentReminder | explicit ephemeral policy, предотвращающая повторную доставку старого |
| Notification | legacy/archive policy, затем адресная история по контракту |
| SyncRemote | secret-excluded; metadata восстановления без credential export |

Сам Workspace не имеет поля workspaceId и потому не попадает в такой grep: его disabledModules/restrictedModules/pluginOverrides и прочие настройки классифицируются отдельно. User/UserPreference/RefreshSession и другие не-workspace таблицы тоже требуют отдельной deployment backup policy. Тест не должен ошибочно считать schema coverage завершённым только по наличию workspaceId.

**Важный rollback:** удаление Project каскадно влияет на Milestone, удаление Document — на versions/annotations. Если дочерняя сущность исключена из backup, простая очистка родителя при apply может её уничтожить. Для каждой cascade связи проверить intentional loss либо восстановление. Нельзя оставлять это неявным.

## Предлагаемые DTO extensions

Это проекты контрактов, не текущие API. Типы выводить из Zod, не копировать TypeScript вручную.

### Доступ

Workspace capabilities возвращают доступные domain IDs и разрешения системных действий, без секретов и необязательных global ACL abstractions. Например:

```ts
type WorkspaceCapabilities = {
  modules: Array<{ id: OrionModuleId; availability: 'enabled' | 'disabled' | 'restricted' }>;
  canManageMembers: boolean;
  canManageModules: boolean;
  canManageBackups: boolean;
};
```

Capabilities помогают UI, но не заменяют повторную server policy при mutation. Если API выдаёт reasons, они не содержат скрытых имён/сумм. При изменении роли инвалидируются и capability cache, и зависимые queries.

### Конфликт версии

Note response получает `revision: integer`. Update input получает `expectedRevision`, обязательный для изменяющих content запросов после переходного этапа. Ответ 409 имеет machine code `REVISION_CONFLICT`, entityId и currentRevision; серверный content отдаётся только если actor всё ещё имеет read access.

Выбор current content отдельным GET безопаснее, чем большой payload каждого конфликта. UI не перезаписывает draft при этом GET.

### Ошибки

Сейчас HttpExceptionFilter нормализует status/message/requestId/path, но не сохраняет произвольные structured codes/details. Если вводятся machine codes, обновить **filter → ApiError → hooks/UI** вместе. Не распознавать конфликт по русскому тексту сообщения.

Предлагаемые коды только при соответствующих задачах:

| Код | HTTP | Действие UI |
|---|---|---|
| MODULE_DISABLED | 409 | Объяснить/owner может включить |
| MODULE_RESTRICTED | 403 | Убрать содержимое и показать отсутствие доступа |
| REVISION_CONFLICT | 409 | Conflict surface с сохранённым draft |
| TIMER_ALREADY_RUNNING | 409 | Показать свой running timer |
| RESTORE_PLAN_EXPIRED | 409 | Повторить preview |
| BACKUP_INCOMPLETE | 422 или согласованный 400 | Не применять, показать состав/причину |
| SERVICE_UNAVAILABLE | 503/transport | Retry, не очищать данные/черновик |

Стабильный HTTP contract выбрать один раз и зафиксировать тестом. Не менять все исключения ради унификации в одной сессии; добавлять совместимые optional code поля.

### Пагинация

Не менять молча `T[]` на `{items}` в одном сервисе. Новый endpoint/параметр либо синхронное изменение всех consumers. Общая цель:

```ts
type Page<T> = { items: T[]; nextCursor: string | null; hasMore: boolean };
```

Для existing finance offset API допустимо сохранить offset и добавить total/hasMore, если это минимальная согласованная правка. Cursor должен кодировать стабильный sort key+id и соответствовать фильтрам; boundary dataset changes тестируются. Query keys включают фильтры и pagination. Totals приходят отдельным aggregate contract.

## RLS для персональных данных

Новая Notification recipient policy должна проверять и current user=recipient, и membership. Иначе общий workspace RLS оставляет возможность получить чужую персональную запись при пропущенном userId фильтре. Системный cron использует существующий asSystem осознанно.

TimeEntry содержит общий командный ledger с разрешёнными manager reports: policy должна соответствовать 08-TEAM. Не ставить грубое userId=current_user на все SELECT, если lead по продукту должен видеть командный отчёт. Возможный путь — явная membership-role predicate плюс ownership и отдельные UPDATE/DELETE policy. Проверить under application role, а не superuser.

Все политики проверяются semantic tests, не только «есть одна policy». Структурный RLS test остаётся полезным первым барьером.

## Порядок безопасных миграций

| Изменение | Добавляющая стадия | Переключение | Удаление старого |
|---|---|---|---|
| Actor time | nullable userId + DTO author | server sets actor, resolve legacy running | old workspace unique index |
| Notifications | recipient/eventKey или новая адресная таблица | новые producers и read APIs | legacy writes; legacy read-only архив |
| Notes CAS | revision default + compatible client | expectedRevision required for content writes | обход CAS старым endpoint |
| Backup | format v2 + validator/coverage | writes new format, old restore safe policy | только после отдельного решения retention |
| Recurring occurrence | key columns/table + unique index | locked recheck + idempotent writes | naive generator path |

Backfill должен быть идемпотентным и иметь counts before/after. Для mixed-version клиентов установить минимальную совместимую версию/maintenance window. Не оставлять optional expectedRevision навсегда: старый клиент иначе сможет обходить защиту новых.

## Осторожно с историей

Новые owner/recipient/author поля нельзя достоверно восстановить из отсутствующих данных. Legacy unknown — полноценное состояние, а не ошибка миграции. Не присваивать действия человеку только потому, что он сейчас owner. Не создавать фиктивную прочитанность и не отправлять тысячи старых уведомлений после backfill.

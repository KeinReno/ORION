# Контракт модуля ORION

> P2-3 (docs/REMEDIATION_REPORT.md). Девять точек, которые модуль обязан поставить
> платформе, и существующие механизмы для каждой. Эталонная реализация контура —
> подключаемый модуль (`apps/api/src/modules-ext/<id>/`): его `module.manifest.json`
> — единственная точка обнаружения, из него `pnpm module-registry` генерирует
> реестры (Nest-модуль, zod-контракты, каталог, snapshot/sync-политики). Встроенные
> (base) модули пока объявляют часть точек вручную — план переноса на манифестный
> контур в P2-2 отчёта по ремедиации.

## 1. Контракты (zod, shared-types)

- Модуль: `packages/shared-types/src/modules-ext/<id>/index.ts` (генерируется из манифеста, `contracts:`). Base-модуль: `packages/shared-types/src/<domain>.ts` + реэкспорт из `index.ts`.
- Каждый вход/выход API — zod-схема; клиенты (`api-client.ts`) и сервер валидируют одну и ту же схему. Новые поля — аддитивно (`.default()` для совместимости со старыми строками/клиентами, см. `approvals` в `agentHubDelegationPolicySchema`).

## 2. Схема БД + миграции

- Модуль держит модели в своей зоне `schema.prisma` (base — маркированный блок, modules-ext — фрагмент `prisma/models.prisma` + `prisma/*.sql` миграций).
- Каждая модель обязана иметь владельца в `scripts/module-ownership.mjs` (`ownershipMapViolations` в architecture-check ломает сборку иначе).
- Workspace-таблицы: `ENABLE` + `FORCE ROW LEVEL SECURITY` + политика членства; явные `GRANT` ролям отдельной миграцией. Проверки: `api-rls`, `rls-coverage`.

## 3. Маршруты

- Nest-контроллер под `@RequireModule("<id>")` (base: `apps/api/src/<dir>/`, modules-ext: генерируется в `modules.generated.ts`).
- Авторизация — деклараторы `@RequirePermission("module.resource.action")` с id из реестра прав (формат `module.resource.action`); новые права добавляются в манифест/реестр и документируются в `docs/platform-api/PERMISSIONS.md`.

## 4. UI-панели и слоты

- Панель модуля регистрируется в `panel-registry.ts` (`moduleId` обязателен — панель скрывается при выключенном модуле). Плагины — только через `contribute()` в слоты из `SlotContracts` (`apps/web/lib/extensions/contracts.ts`); прямой импорт внутренностей хоста запрещён (architecture-check, G-rules).
- Составной экран модуля сегментируется как у Agent Hub: очередь/действия/политика/журнал — секциями одной панели, а не размазывается по чужим.

## 5. Провайдер поиска

- Тип записи — в закрытом каталоге `SearchableEntityType` (`packages/shared-types/src/search.ts`); адаптер титулов/ссылок — в `apps/api/src/entity-links/entity-registry.ts` (ENTITY_REGISTRY: `moduleId`, опционально `pluginId`).
- Провайдер глобального поиска — `SearchProvider` в реестре `apps/api/src/search/search-provider.registry.ts`. Выключенный модуль/плагин не опрашивается вовсе — гейт `accessibleTypesTx` (entity-links) решает по `moduleId`/`pluginId`, модуль ничего не проверяет сам.

## 6. Типы уведомлений

- Адресные уведомления человеку — через `NotificationCenterService` с типом из каталога типов уведомлений; упоминания (`@Имя`) разбираются общим `parseMentions` (shared-types), адресность решает модуль членства.
- События для агентского членства — `AgentMemberEvent` (очередь модуль членства, не блокирующая).

## 7. Вклад в бэкап/восстановление

- Политика снапшота каждой модели — `snapshotPolicy` в манифесте (`included | derived | identity-excluded | secret-excluded | ephemeral-excluded`) с причиной; modules-ext → `data.generated.ts` (G10). Base-модели сейчас — центральный `apps/api/src/sync/snapshot-registry.ts` (ручной список, см. P2-2).
- Класс синхронизации (`SYNC_CLASSIFICATION`) — там же. Забытая модель ломает инвентарные тесты (`whole-node-snapshot-inventory`, `migration-table-inventory`, DMMF-сверка в `snapshot.integration.test.ts`), а не выпадает из бэкапа молча.
- Бэкап включает данные выключенных модулей намеренно (политика «не удалять данные отключённого модуля»); восстановление не возобновляет внешние разрешения (`PublicationRule` и т.п.).

## 8. Схема настроек

- Настройки модуля — через реестр настроек пространства/узла с zod-схемой значений; экран настроек читает ту же схему. Политики модуля (лимиты, режимы) — отдельным контрактом с owner/lead-гейтом записи (образец: `agentHubDelegationPolicy`).

## 9. Политики доступа

- Права — `module.resource.action` из реестра (точка 3); матрица решений для агентских токенов — `decideAgentOperation`/`decideAgentModuleOperation` (shared-types `agent-policy.ts`): режим токена ∩ скопы ∩ запреты, каждый шаг только ужесточает.
- Cross-module чтение — только через публичные контракты владельца (`public/` или `public.ts`); прямые `tx.<чужая модель>` и импорт чужих сервисов запрещены механически (G4 + `foreignQueryHelperViolations`, исключения — только сокращаются).

## Дополнительно (не из девяти, но обязательно)

- **Доменные события**: публикация через общий outbox (`DomainEventBus`), подписка — декларативно; доставка изолирует падение подписчика (SAVEPOINT), есть диагностика и ручной replay.
- **Фоновые задачи**: декларативный `BackgroundJobRegistry`; `BackgroundJobSupervisor` не запускает задачу компонента, выключенного в пространстве.
- **Манифест**: modules-ext — полный `module.manifest.json` (permissions/api/web/prisma/data/agent) + `pnpm module-registry` + `pnpm module-docs:check`. Base-модули — блок манифеста в документации (`pnpm module-docs`).

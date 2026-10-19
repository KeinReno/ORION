# Storage API (G10, G11)

## Как сейчас (v1.0, зафиксировано)

Два разных слоя; общего «Storage API для модулей» нет (аудит §2.6).

**Файлы (бинарные данные).** Интерфейс `StorageAdapter` (`apps/api/src/storage/storage-adapter.ts`, токен `STORAGE_ADAPTER`):
`putFile`, `mkdir`, `move`, `copy`, `getStream` (с `Range`), `remove`, `exists`. Ключ — POSIX-путь
`<workspaceId>/<папка>/.../<имя>`, строится `storageKey(...)` из цепочки `Document.parentId`, отдельной колонкой не хранится.
Драйверы: `local` (`local-disk.storage.ts`) и `webdav` (`webdav.storage.ts`); выбор — `STORAGE_DRIVER` в
`apps/api/src/storage/storage.module.ts` (неизвестное значение — ошибка старта). Корзина — `<ws>/.trash/<id>`. Третий драйвер (S3)
не реализован.

**Структурированные данные.** Единая схема Prisma для ядра и всех модулей: `apps/api/prisma/schema.prisma`, единая цепочка
миграций `apps/api/prisma/migrations/`. Изоляция по пространству: `workspaceId` + `ENABLE`/`FORCE ROW LEVEL SECURITY` +
политики; доступ только через `PrismaService.withUser` / `asSystem` (`apps/api/src/common/prisma.service.ts`); роли БД
`orion_app` / `orion_system` (`infra/postgres/init/01-app-roles.sql`). Структурный тест `apps/api/test/api-rls.integration.test.ts`
падает на таблице с `workspaceId` без RLS. RLS изолирует по пространству, **не по модулю**: любая служба внутри `withUser`
видит все таблицы пространства.

**Что новый модуль делает вручную** (CLAUDE.md, чек-лист): модель в общей схеме, RLS-миграция raw-SQL, запись в
`SNAPSHOT_MODEL_REGISTRY` (`apps/api/src/sync/snapshot-registry.ts`; политики `included|derived|identity-excluded|secret-excluded|ephemeral-excluded`,
сверка с `Prisma.dmmf` при старте) и в `SYNC_CLASSIFICATION` (`apps/api/src/sync/sync-classification.ts`; классы
`mergeable-text|lww-fields|append-only|strict|not-synced`).

**Резервное копирование:** `.orion`-архив `{ blobs, snapshot }`, `SNAPSHOT_VERSION = 2`
(`apps/api/src/sync/snapshot.service.ts`, `blob-backup.service.ts`). Выключение модуля данные не удаляет (Конституция п.14).

## Контракт v1.0 как есть

Публичный для компонентов — только `StorageAdapter` (файлы) и правила RLS/`withUser`. Поле манифеста `migrations` существует,
пусто, не используется. Квот и пространств имён на компонент нет.

## Целевое состояние

Декларация данных компонента в манифесте: модели, владелец, политика бэкапа и синхронизации, шаблон RLS, миграции с версиями;
генератор миграции; реестры снапшота и синхронизации заполняются из манифеста. Структурные тесты (RLS, снапшот, sync)
сохраняются как есть. Критерий G10: образец (Pet Care) изолирован и попадает в бэкап без ручной правки реестров ядра.

## Не сделано

Объявление данных компонента (G10); версии данных компонента, снимок перед обновлением и откат при сбое миграции (G11; проверка «объявленные миграции ↔ применённые» есть — `GET system/components`);
экспорт данных одного компонента; S3-драйвер; fault-injection тесты WebDAV (CLAUDE.md); данные Compass-движка лежат
в его SQLite вне Postgres/RLS/бэкапа (G22, `apps/api/src/markets/compass-engine.service.ts`).

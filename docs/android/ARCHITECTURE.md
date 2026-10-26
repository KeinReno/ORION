# Архитектура Android alpha

Статус: решение для разрешённого владельцем первого среза; серверный API не меняется.

## Что найдено
- apps/api: NestJS, Prisma/PostgreSQL, membership + RLS; Android не получает доступ к БД.
- packages/shared-types: Task, Note, статусы, входные схемы и sync protocol v1.
- packages/core: ReplicaEngine, ReplicaStorage, applyOpLocally, apiSyncTransport.
- apps/web: Next.js/Dockview; apps/desktop: Tauri + локальный сервер.
- LAN реализован серверным Node-клиентом с TLS pairing, не библиотекой Android.
- docs/PLAN.md в этой ревизии отсутствует; действуют PLATFORM.md и STATUS.md.

## Решение
Отдельное apps/android: React + Vite + Capacitor 8. Общие TypeScript-контракты
переиспользуются без Kotlin-копий. Next.js, Dockview, PostgreSQL и desktop runtime
не попадают в APK. Capacitor выбран для повторного использования моделей и
механики проекции; это WebView-клиент с нативным хранилищем, не Compose.

packages/mobile-core содержит локальный repository и строго ограниченный
LAN-профиль. Зависимости направлены только в public @orion/core и
@orion/shared-types. UI ничего не знает о SQL.

На Android небольшой собственный Capacitor plugin хранит атомарный JSON-снимок
в SQLite private app storage; сущности, outbox, HLC, deviceSeq и черновик
фиксируются одним commit. Для браузерной разработки — IndexedDB с тем же
интерфейсом. Ошибка записи не публикует новое состояние в UI. Все изменения
сериализованы, сохранённые данные валидируются до использования.

Снимок version=1 — явная версия локального формата. Неизвестная версия и
повреждение не перезаписываются пустым пространством. Снимок ограничен 8 MiB;
для больших объёмов следующий этап — таблицы по сущностям и outbox с миграцией.
Хранилище изолировано Android sandbox, но не имеет дополнительного шифрования.
Backup Android отключён до проектирования безопасного восстановления deviceSeq.

## Границы
Локальное пространство имеет собственную идентичность и никогда автоматически
не переименовывается в удалённое. Записи пока не синхронизируются.
ReplicaEngine не запускается на фиктивном серверном снимке. Используется его
публичная проекция операций; локальные транзакции имеют отдельный жизненный цикл.
Подключение удалённого workspace потребует отдельного явно выбранного импорта
и нового replica storage scope, а не присваивания локальной очереди другому workspace.

Desktop, API, существующие схемы и миграции не изменяются.

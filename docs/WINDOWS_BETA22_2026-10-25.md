# Windows beta 22: контрольная точка модульных границ

База: master db91b2da841e3d828882d48e4878d9eb9973437b (PR #73).
Ветка: codex/module-independence-arc. Выпуск ограничен контрольной точкой по решению владельца.
Арка целиком НЕ завершена: после выпуска продолжить Goals, списки/склад/финансы, вложения,
поиск/обзор, AI и усиление сканера helper/alias/SQL. Не повторять уже принятые PR #68–73.

## Контрольная точка

TasksService больше не читает/создаёт Project и не читает Milestone напрямую. Запросы принадлежат
Projects и Milestones через публичные контракты; SDK независимы от полных соседних Nest-модулей.
Сохраняются авторизация, 404/400, case-insensitive поиск метки, id priority, null, архив/отключение
и откат созданного проекта при ошибке задачи. Конкурентная уникальность имён не добавлялась.
ADR-0032, Integration API 1.7.0 / Platform API 1.8.0; карта и паспорта обновлены.
Исключения: 18 → 17 файлов, 52 → 50 model entries, service entries — 19.

Focused integration: 18 passed / 3 файла, 53.72 с; шесть новых сценариев включая состав Tasks без
ProjectsModule/MilestonesModule. Проверены новые/повторные имена, update/null/id priority,
чужие пространства/вехи, rollback, RLS, архив/отключение, отказ до SDK. Никаких schema/UI миграций.
Unit: 1476 passed / 190 файлов, 137.08 с; lint: 0 ошибок / 30 прежних предупреждений.
Architecture, module-docs, registry и capability map прошли; snapshot/plugin contracts входят в unit.
Typecheck/integration/browser и сборка кандидата выполняются; итоги будут дописаны.

## Состав выпуска

Кроме этой точки, beta 22 включает изменения master после beta 21: проверка совместимости
при включении/API, карта для агентов, синхронное закрытие таймера Tasks→Time, публичные ссылки
Health→Contacts, Notes/Documents/Inbox/Inventory→Projects, Time/Calendar→Tasks/Projects,
Finance→Projects, исправление невидимой подложки Modal/Sheet и блокировок outbox.

## Проверка пакета и границы

Тег кандидата v0.1.0-windows-beta.22; версия приложения 0.1.0 (как в beta 21), обновления
различаются build tag. Перед публикацией проверить build.json, commit, API, статический web,
Node/PostgreSQL/Prisma, миграции, отсутствие .env/ключей/пользовательских БД, NSIS и SHA-256.
GitHub CI имеет известный billing-блок; приёмка локальная. Архивная/браузерная проверка не
означает установку на чистую Windows, обновление личной установки или физические устройства.
Предыдущий запуск packaged runtime был отклонён автоматическим approval review (blocked by policy);
повтор/обход этого запуска не выполняется. Это не препятствует разрешённой упаковке и публикации.

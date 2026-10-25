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
Typecheck прошёл. Полный integration: **616 passed / 1 skipped**, 109 passed-файлов, 1035.63 с.
В логе нет 40P01/deadlock. Итоговый Chromium: **56 passed**, 2.7 мин, production API/web (54 страницы),
оба профиля плагинов, проекты/таймер/финансы/здоровье/контакты/Knowledge/настройки; снимки действий не менялись.
Первый browser-прогон прерван: одновременный desktop export заменил промежуточный .next. В Next 14.2.35
next/dist/build/index.js (configOutDir) export всегда использует внутренний .next даже с выходом .next-desktop.
После окончания export production web пересобран с NEXT_PUBLIC_API_URL=http://localhost:4144;
все браузерные сценарии повторены успешно без параллельного export. Runtime API от той же ревизии.
Исходники/тесты: 81e4007392e27af5c02b5465045fe069cd9f2af4; последующие изменения — только отчёт.
После перерыва обнаружены остановленный первый NSIS-процесс и незавершённый временный файл;
он не публиковался. Причина остановки не установлена. Повторная Tauri/NSIS-сборка завершилась успешно.

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

## Готовый пакет beta 22

Source/tag target: 81e4007392e27af5c02b5465045fe069cd9f2af4; runtime/build.json: v0.1.0-windows-beta.22 @ 81e4007.
NSIS x64: ORION_0.1.0_x64-setup.exe, 73899690 байт.
SHA-256: 53266aeaa2f5d7d3d626830f9fc6df360cb8b91283ebb1d41fbe2b06d4c0db60.
7-Zip integrity passed; archive/stage build.json совпадают, schema совпадает с исходниками,
все 143 миграции присутствуют. Node/PostgreSQL/Prisma/API/web и новые SDK есть в архиве;
.env/личная конфигурация/маркеры пользовательской БД отсутствуют. Подпись: NotSigned.
Packaged AppModule/Prisma/Platform API 1.8.0 import passed (NODE_ENV=test, без старта сервера).
Первый import-check ошибочно разрешал shared-types из API root (workspace TS); исправлена оснастка
на контекст dist/app.module, как у entrypoint. Код пакета не менялся ради проверки.
Готовые BUILD_INFO.txt и SHA256SUMS.txt публикуются вместе с EXE.
[Windows beta 22](https://github.com/KeinReno/ORION/releases/tag/v0.1.0-windows-beta.22).
Тег указывает на кодовую ревизию 81e4007; последующий отчёт не меняет содержимое установщика.

# Time и Calendar: публичные проекции Tasks / Projects

База: master `5789e2b4ce22a24c31d34083a005d13727398d18` (PR #71).
Код и тесты: `b4f033a` (последующие изменения этого этапа — только итоговая документация).
Реализация: `codex/time-calendar-contracts`; [ADR-0030](adr/ADR-0030-task-integration-reader.md),
[контракт](platform-api/TASK_INTEGRATION_READER.md). UI, schema, миграции и права не меняются.

## Изменения

Time больше не читает Task/Project, Calendar (EventsService) — Project и Task.
Публичный TaskIntegrationReader возвращает узкие проекции ссылки и полей ICS в исходной
транзакции/RLS, с явным workspaceId. Projects проверяются принятым ProjectReferences.
Реализации .service.ts принадлежат владельцам и остаются под architecture-check;
SDK не импортируют TasksModule/ProjectsModule или их сервисы.

Авторизация, прежние 404, null, приоритет явного проекта над унаследованным сохраняются.
Обнуление только projectId при сохранённой задаче снова наследует её проект — прежнее поведение.
Time сохраняет ссылки при выключенных соседях. Calendar сохраняет формат ICS, UID, описание,
projectTag, отметку done, включение всех статусов со сроком и 15-минутную длительность.
Feed token, Calendar/calendar-external и Tasks проверяются до чтения задач. Только владелец
исходящего фида создаёт system-транзакцию; reader не повышает роль.

Две записи exceptions удалены целиком: **21 → 19 файлов**, **57 → 53 model entries**,
service entries остаются **19**. Новых исключений нет. Integration API **1.5.0** /
Platform API **1.6.0**, capability map, snapshot и паспорта обновлены.

## Проверки

Windows/PowerShell. Отдельная PostgreSQL 16 на 127.0.0.1:5444; только синтетические
orion_platform_integration / orion_platform_browser. Пользовательская БД не используется.

Focused integration: **19 passed / 3 файла**, 21.51 с. Файлы: time-calendar-contracts,
time-entries, task-time-bridge в apps/api/test/ (суффикс .integration.test.ts). Семь новых сценариев: timer/manual/update/null,
невалидная замена без изменения записи и без лишних таймеров, чужой проект/задача при доступе к обоим
пространствам, отказ постороннему до readers, выключенные соседи, ссылки событий, ICS поля и
изоляция пространств, отсутствие задач без срока, отзыв/ротация токена, отключение Tasks и
calendar-external без вызова reader, RLS, незакоммиченная строка/rollback и удалённая задача.
Отдельный Nest host запускает Time + Calendar без полных TasksModule/ProjectsModule:
полные сервисы отсутствуют, Tasks HTTP даёт 404, запись времени наследует проект, событие
сохраняет ссылку, исходящий ICS содержит задачу через SDK.

Первый focused запуск: один отказ тестовой композиции — не добавлен инфраструктурный
PluginsModule для существующего PluginEnabledGuard Calendar. После добавления в тестовый host
все 19 сценариев прошли; production-архитектура ради теста не менялась.

Полный unit: **1476 passed / 190 файлов**, 59.81 с. Typecheck passed; lint **0 ошибок /
30 прежних предупреждений**. Architecture/registry/docs/map passed, snapshot/plugin contracts
входят в unit. Production API/web build: passed, **54 страницы**; compiled API содержит новый
reader и Platform API 1.6.0. Chromium: **46 passed**, 1.7 мин — 42 сценария панелей
default-full/plugins-off, 2 сценария открытия объектов календаря и 2 остановки таймера
при закрытии задачи. Снимки действий не менялись. Полный integration на пересозданной БД:
**603 passed / 1 skipped**, 107 passed-файлов, 404.14 с. Все семь новых сценариев входят
в прогон. В логе нет 40P01/deadlock; искусственные HTTP 500 lifecycle rollback ожидаемы.
Локальные логи: stage5-focused.log, stage5-unit.log, stage5-integration.log, stage5-browser.log,
stage5-typecheck.log, stage5-lint.log (ignored). Браузер запущен через scripts/e2e-local.mjs
для e2e/panels.spec.ts, e2e/task-time-bridge.spec.ts и e2e/calendar-object-opening.spec.ts;
full integration — vitest.integration.config.mts после scripts/e2e-db.mjs.
GitHub CI с учётом известного billing-блока не заменяет локальную проверку.

## Границы

Проверяется отсутствие полных доменных Nest-модулей для данной композиции с сохранёнными
SDK и таблицами. Физическое удаление таблиц, hot-install, native Windows runtime не проверялись.
Остальные 19 файлов исключений мигрируются отдельно; новый установщик не выпускается.

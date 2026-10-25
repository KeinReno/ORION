# Finance → Projects: ссылки и валюта проекта

База: master `7a2590461426717df5f5dd85f35d2d6f0184f3f3` (PR #72).
Код и тесты: `2872fc5`; последующие изменения этого этапа — только итоговая документация.
Реализация: `codex/finance-project-contract`; [ADR-0031](adr/ADR-0031-project-finance-reader.md),
[контракт](platform-api/PROJECT_FINANCE_READER.md). UI, schema, миграции и права не меняются.

## Изменения

ProjectCostsService больше не читает Project напрямую: Projects-owned ProjectFinanceReader
возвращает только {currency} либо null, одним запросом вместо прежних existence + currency.
Операции и шаблоны проверяют ссылки через ProjectReferences; finance-refs.util.ts получает
reader явно и больше не запрашивает Project. Запросы владельца в .service.ts остаются
под architecture-check, ограничены id/workspaceId и сохраняют транзакцию/RLS без новой роли.
SDK не импортируют полный ProjectsModule/ProjectsService.

Авторизация, прежний 400 «Проект не найден в этом рабочем пространстве», null и допустимость
архивных/выключенных Projects сохранены. Расчёты затрат остаются в Finance: отдельные валюты,
без конверсии, ведущая валюта проекта при наличии операций в ней, иначе большее число операций
и алфавит при равенстве; transfers не считаются. Guards Finance/плагинов не меняются.

Исключение project-costs удалено: **19 → 18 файлов**, **53 → 52 model entries**, service entries — **19**.
Дополнительно устранён запрос helper, который счётчик service-исключений не видел. Общий сканер
по-прежнему не гарантирует покрытие произвольных util/alias/raw SQL; запрос не спрятан в новый util.
Integration API **1.6.0** / Platform API **1.7.0**, snapshot/карта/паспорта обновлены.

## Проверки

Windows/PowerShell, отдельная PostgreSQL 16 на 127.0.0.1:5444. Только синтетические
orion_platform_integration / orion_platform_browser. Пользовательская БД не используется.

Focused: **17 passed / 3 файла**, 34.56 с: finance-project-contract, finance-project-costs,
finance-currency в apps/api/test/ (суффикс .integration.test.ts). Семь новых сценариев проверяют
операции/шаблоны create/update/null, чужой id при доступе к обоим пространствам, 400 и сохранность
записей/строк после отказа, точные суммы RUB/USD и смену ведущей валюты, отказ постороннему
до readers, выключенный plugin guard, архив/выключенные Projects, RLS, uncommitted/rollback,
удалённый проект и ограниченный состав currency projection. Отдельный Finance host без полного
ProjectsModule сохраняет операции и шаблоны и возвращает затраты; ProjectsService отсутствует,
Projects HTTP даёт 404. SDK и таблица Project остаются. Отчёт при выключенном Projects
проверен на service-уровне; HTTP сохраняет существующие guards модуля и плагина.

Unit: **1476 passed / 190 файлов**, 80.92 с. Typecheck passed; lint — **0 ошибок / 30 прежних
предупреждений**. Architecture/registry/docs/map passed; snapshot/plugin contracts входят в unit.
Production API/web build прошёл (54 страницы), compiled API содержит currency reader и Platform API 1.7.0.
Chromium: **44 passed**, 1.6 мин — 42 панели default-full/plugins-off и 2 новых сценария:
переключение USD/RUB, загрузка после reload, скрытая вкладка при отключённых плагинах с сохранёнными
операциями. Снимки действий не менялись. Все целевые сценарии прошли с первого запуска.
Полный integration на пересозданной БД: **610 passed / 1 skipped**, 108 passed-файлов,
579.16 с. Все семь новых сценариев входят в прогон. В логе нет 40P01/deadlock;
искусственные HTTP 500 lifecycle rollback ожидаемы.
Локальные логи stage6-*.log ignored; команды — vitest.integration.config.mts после e2e-db.mjs;
browser — e2e-local.mjs для panels.spec.ts и finance-project-contract.spec.ts.
GitHub CI имеет известный billing-блок; приёмка этого этапа локальная.

## Границы

Нет физического удаления SDK/таблиц, hot-install или native Windows приёмки. Остальные
18 файлов исключений — отдельная очередь. Новый установщик не выпускается.

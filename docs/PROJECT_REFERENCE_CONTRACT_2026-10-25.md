# Публичная проверка ссылок на проекты

Исходная база: master `1e25c0c290871327b1b2c50e22b44c836862e101`, PR #70.
Реализация: `codex/project-reference-contract`; [ADR-0029](adr/ADR-0029-project-reference-reader.md),
[контракт](platform-api/PROJECT_REFERENCES.md). Срез этой ветки; UI, schema, миграции и права не меняются.

## Изменения

Notes, Documents, Inbox, Inventory и Milestones больше не читают Project напрямую.
`ProjectReferences.existsTx` возвращает только boolean; запрос принадлежит Projects,
ограничен id/workspaceId, выбирает только id, использует исходную транзакцию/RLS.
Reader не открывает транзакции и не переключает роль. Реализация `.service.ts` остаётся
под architecture-check. SDK-модуль не импортирует ProjectsModule/ProjectsService.

Сохраняются проверки прав перед reader, прежние 404 и null shortcuts. Архивные проекты
допустимы. При отключённом Projects Notes/Documents/Inventory сохраняют прежнее поведение;
Inbox проверяет включённость до reader и даёт 409, но может принять запись без projectId.
HTTP Milestones остаётся за guard Projects; его сервис проверяет только ссылку.

Пять файлов целиком удалены из исключений: **26 → 21 файл**, **62 → 57 model entries**;
service entries остаются **19**. Новых исключений нет. Integration API **1.4.0** /
Platform API **1.5.0**, snapshot, карта возможностей и паспорта обновлены.

## Локальная проверка

Windows / PowerShell. PostgreSQL 16 на 127.0.0.1:5444, только синтетические
orion_platform_integration / orion_platform_browser. Пользовательская рабочая БД не используется.

Focused integration: **22 passed / 5 файлов**, 24.55 с. Девять новых сценариев проверяют:
пять потребителей через HTTP, чужой workspace при доступе актёра к обоим пространствам,
отсутствующий projectId без частичной записи, отказ постороннему до reader, архив/выключение,
замену/null и сохранность прежней ссылки после отказа, RLS и видимость незакоммиченного проекта
с последующим rollback. Отдельный Nest host запускает все пять потребителей без полноценного
ProjectsModule: SDK и таблица остаются, ProjectsService недоступен, projects HTTP даёт 404,
команды потребителей успешно сохраняют ссылку.

Первый focused запуск: 3 отказа новых тестов. Оснастка ошибочно читала документ через
несуществующий GET /documents/:id и отключала Projects без подтверждения включённых зависимых.
Исправлена на чтение списка документов и confirm:true существующего API. Приложение ради
оснастки не менялось; повтор всех пяти файлов прошёл.

Полный unit: **1476 passed / 190 файлов**, 50.54 с. Typecheck passed; lint **0 ошибок /
30 прежних предупреждений**. Architecture-check, module-docs, module-registry и platform-map
passed; plugin contracts и snapshot входят в полный unit. Снимки действий интерфейса не менялись.

Production API/web build: passed, **54 страницы**. Chromium: **44 passed**, 1.6 мин —
42 сценария панелей default-full/plugins-off и 2 пути project → task → linked note → project
с сохранением связи после правки. Compiled API содержит новый reader и Platform API 1.5.0.
Полный integration на пересозданной БД: **596 passed / 1 skipped**, 106 passed-файлов,
397.36 с. Все девять новых сценариев входят в прогон. В логе нет 40P01/deadlock;
искусственные HTTP 500 из lifecycle rollback тестов ожидаемы.
GitHub CI на кодовом commit `261f39c2df09fd0b610650ff6cb51208245546fe`: run 40208670582,
quality check 121215006261 завершился до выполнения шагов (steps: []). Annotation: recent account
payments have failed or spending limit needs to be increased. Это инфраструктурный блок, не green CI;
локальные проверки учитываются отдельно.

## Границы проверки

Отсутствие ProjectsModule проверено для композиции пяти потребителей, а не для всего ORION:
Goals и другие ещё не мигрированные домены могут импортировать полный ProjectsModule.
Физическое удаление SDK/таблиц, hot-install, native Windows runtime и новый установщик не проверялись.
Остальные 21 файл исключений остаются отдельной очередью. Опубликованная beta 21 не меняется.

# ADR-0031: Finance читает Projects через публичные контракты

Статус: принято для переноса Finance → Projects, 25.10.2026.

NEW_EXTENSION_POINT_REQUIRED: отчёт затрат читает Project.currency, а общий finance helper
проверяет Project напрямую для операций и шаблонов. Для проверки ссылки применяется
ProjectReferences (ADR-0029). Новый Projects-owned ProjectFinanceReader.currencyTx(tx,
workspaceId, projectId) возвращает только {currency} либо null; отдельный SDK module
не импортирует ProjectsModule/ProjectsService. Запрос .service.ts покрывает architecture-check.

Запросы ограничены workspaceId и сохраняют исходную транзакцию/RLS, без новой роли/транзакции.
Авторизация и прежний BadRequest 400 остаются у Finance. Архив и отключение Projects не меняют
допустимость ссылки. Расчёты по валютам, порядок выбора ведущей валюты, отсутствие курсового
пересчёта и сохранность данных не меняются. Project costs получает существование и валюту
одним запросом вместо двух. Общий helper получает публичный reader явно, не Prisma Project.

Удаляется исключение project-costs.service.ts, новых исключений нет. Не маскируется долг
переносом запроса в util: существующий Project-запрос из finance-refs.util.ts удаляется.
Сканер архитектуры по-прежнему не гарантирует покрытие произвольных util/SQL/alias.
Integration API 1.6.0 / Platform API 1.7.0. Приёмка: денежная parity, HTTP create/update/template,
ошибки без частичных записей, доступ к обоим пространствам, RLS/rollback, отключённые Projects,
состав Finance без полного ProjectsModule. Schema/UI/ownership не меняются.

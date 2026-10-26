# Валюта проекта для Finance

Integration API 1.6.0 / Platform API 1.7.0; [ADR-0031](../adr/ADR-0031-project-finance-reader.md).
Публичные входы Projects: apps/api/src/projects/public/project-finance-reader.ts и
apps/api/src/projects/public/project-finance-reader.module.ts.

Finance импортирует ProjectFinanceReaderModule и получает ProjectFinanceReader через DI.
currencyTx(tx, workspaceId, projectId) возвращает только {currency: string} либо null.
Query принадлежит Projects, находится в .service.ts под architecture-check, ограничен
id/workspaceId, выбирает только currency и сохраняет исходную транзакцию/RLS. Новых
транзакций, переключения роли и выдачи прав нет. SDK не импортирует ProjectsModule/ProjectsService.

ProjectCostsService сначала авторизует пользователя, затем получает существование и валюту
одним запросом. Отсутствующий/чужой проект даёт прежний HTTP 400 «Проект не найден в этом
рабочем пространстве». Выбор ведущей валюты остаётся в Finance: валюта проекта при наличии
операций в ней, иначе валюта с наибольшим числом операций, равенство — по алфавиту.
Деньги разных валют не складываются и не конвертируются; transfers не входят в затраты.

Transactions и Templates используют ProjectReferences (ADR-0029), а finance-refs.util.ts
получает reader явно вместо прямого чтения Project. Null проходит без query. Потребители
сохраняют авторизацию, прежний 400 и политику ссылок на архивные/выключенные Projects.
Guards finance-project-costs/finance-templates и Finance остаются на HTTP-границах.

Finance проверен в отдельном Nest host без полного ProjectsModule, при сохранённых SDK
и таблице Project. Это не обещает физического удаления схемы, hot-install или независимости
других доменов. Карта для агентов обновлена: pnpm platform-map; декларации не runtime grants.

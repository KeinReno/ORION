# Финансы (`finance`)

Финансы: счета, категории, операции со строками и разбивкой, бюджеты, цели, обязательства, повторяющиеся платежи, курсы валют, отчёты.

Крупный модуль из вложенных подкаталогов (`accounts`, `transactions`, `budgets`, `recurring`, …). Повторяющиеся платежи материализует `recurring/recurring-checker.service.ts` (каждый час, под блокировкой строки правила), оповещения по бюджетам — `budget-alerts.service.ts`.

Ссылки на счёт, категорию и проект проверяются на принадлежность тому же пространству (`finance-refs.util.ts`).

Работает без проектов — привязка к проекту необязательна.

Ссылки проектов в операциях и шаблонах проверяет `ProjectReferences`; валюту для затрат читает `ProjectFinanceReader`. Оба Projects SDK используют исходную транзакцию/RLS, без полного ProjectsModule. Ошибки 400 и денежные расчёты остаются в Finance. [Контракт](../../../../docs/platform-api/PROJECT_FINANCE_READER.md).

Межмодульные операции выполняются через публичные SDK владельцев; полные доменные модули ради ссылки/команды не импортируются. [Контракты и правила](../../../../docs/platform-api/MODULE_BOUNDARY_SDKS.md).

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `finance` / 1.0.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `projects` |
| Права (permissions) | `finance.transaction.read`, `finance.transaction.create`, `finance.transaction.update`, `finance.transaction.delete`, `finance.draft.propose` |
| События | публикует: —; слушает: — |
| Панели веба | `finance` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/finance/accounts`, `workspaces/:workspaceId/finance/budgets`, `workspaces/:workspaceId/finance/categories`, `workspaces/:workspaceId/finance/category-rules`, `workspaces/:workspaceId/finance/drafts`, `workspaces/:workspaceId/finance/exchange-rates`, `workspaces/:workspaceId/finance/goals`, `workspaces/:workspaceId/finance/obligations`, `workspaces/:workspaceId/finance/projects/:projectId/costs`, `workspaces/:workspaceId/finance/recurring`, `workspaces/:workspaceId/finance/reports`, `workspaces/:workspaceId/finance/settings`, `workspaces/:workspaceId/finance/splits`, `workspaces/:workspaceId/finance/templates`, `workspaces/:workspaceId/finance/transactions`, `workspaces/:workspaceId/finance/transfer-match` |
| Плагины, расширяющие модуль | `finance-budgeting`, `finance-goals`, `finance-recurring`, `finance-reports`, `finance-quick-entry`, `finance-import`, `finance-obligations`, `finance-forecast`, `finance-project-costs`, `finance-net-worth`, `finance-transfer-match`, `finance-templates`, `finance-split`, `finance-exchange-rates`, `finance-ai-drafts` |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/finance/` |
| При выключении | Панель и фоновая материализация платежей останавливаются. Операции сохраняются. |
<!-- generated:manifest:end -->

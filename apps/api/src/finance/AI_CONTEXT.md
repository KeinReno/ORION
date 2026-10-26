# Контекст агента: модуль finance

Сначала прочитайте `MODULE.md` рядом. Финансы: счета, категории, операции со строками и разбивкой, бюджеты, цели, обязательства, повторяющиеся платежи, курсы валют, отчёты.

Каждый метод сервиса начинается с проверки членства и идёт через `PrismaService.withUser`; ссылки на другие записи проверяются на принадлежность тому же пространству; ответы собираются `toDto`, а входы валидируются zod-схемами из `shared-types`.

Ссылки проектов в операциях и шаблонах проверяет `ProjectReferences`; валюту для затрат читает `ProjectFinanceReader`. Оба Projects SDK используют исходную транзакцию/RLS, без полного ProjectsModule. Ошибки 400 и денежные расчёты остаются в Finance. [Контракт](../../../../docs/platform-api/PROJECT_FINANCE_READER.md).

Межмодульные операции выполняются через публичные SDK владельцев; полные доменные модули ради ссылки/команды не импортируются. [Контракты и правила](../../../../docs/platform-api/MODULE_BOUNDARY_SDKS.md).

<!-- generated:manifest:start -->
## Для агента (генерируется)

Блок собирается `pnpm module-docs`; руками не править.

- Точки входа: API `workspaces/:workspaceId/finance/accounts`, `workspaces/:workspaceId/finance/budgets`, `workspaces/:workspaceId/finance/categories`, `workspaces/:workspaceId/finance/category-rules`, `workspaces/:workspaceId/finance/drafts`, `workspaces/:workspaceId/finance/exchange-rates`, `workspaces/:workspaceId/finance/goals`, `workspaces/:workspaceId/finance/obligations`, `workspaces/:workspaceId/finance/projects/:projectId/costs`, `workspaces/:workspaceId/finance/recurring`, `workspaces/:workspaceId/finance/reports`, `workspaces/:workspaceId/finance/splits`, `workspaces/:workspaceId/finance/templates`, `workspaces/:workspaceId/finance/transactions`, `workspaces/:workspaceId/finance/transfer-match` (за `@RequireModule("finance")`); панель веба `finance`; код `apps/api/src/finance/`.
- Права: `finance.transaction.read`, `finance.transaction.create`, `finance.transaction.update`, `finance.transaction.delete`, `finance.draft.propose`.
- Модуль владеет: Счета, категории, операции, бюджеты, цели, правила.
- Соседи: жёсткие: —; мягкие: `projects`; чужие данные читать только через их публичный контракт, мягких соседей спрашивать через `isEnabled`.
- Расширения: плагины: `finance-budgeting`, `finance-goals`, `finance-recurring`, `finance-reports`, `finance-quick-entry`, `finance-import`, `finance-obligations`, `finance-forecast`, `finance-project-costs`, `finance-net-worth`, `finance-transfer-match`, `finance-templates`, `finance-split`, `finance-exchange-rates`, `finance-ai-drafts`.
- Выключение модуля не удаляет данные; новые таблицы — только с ENABLE + FORCE RLS и записью в реестре снапшота.
<!-- generated:manifest:end -->

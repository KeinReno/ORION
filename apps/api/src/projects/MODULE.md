# Проекты (`projects`)

Проекты как контейнер работы: статус, сроки, бюджет, ставка, вехи-соседи и привязка других сущностей по `projectId`.

Рядом с проектом живут обновления (`project-updates`), захваты (`project-captures`), идеи и проблемы; удаление проекта архивирует его, а не стирает историю.

Работает без задач, финансов и учёта времени — связанные показатели просто не показываются.

Публичная проверка ссылки: `ProjectReferences` / `ProjectReferencesModule` в `public/`; возвращает boolean в исходной транзакции/RLS, без загрузки ProjectsModule. Контракт и политика потребителей: [PROJECT_REFERENCES](../../../../docs/platform-api/PROJECT_REFERENCES.md). Milestones использует тот же контракт; его HTTP остаётся за guard Projects.

Публичный `ProjectFinanceReader` / `ProjectFinanceReaderModule` в `public/` предоставляет Finance только валюту существующего проекта в исходной транзакции/RLS. Без загрузки полного ProjectsModule. [Контракт](../../../../docs/platform-api/PROJECT_FINANCE_READER.md).

Tasks использует публичные `ProjectTaskLinks` и `MilestoneReferences` для проектов и вех. Команда создания проекта остаётся в исходной транзакции задачи; SDK не загружают полные соседние модули. [Контракт](../../../../docs/platform-api/TASK_PLANNING_LINKS.md).

Goals использует `ProjectCatalog`, `GoalTaskReader` и `GoalMilestoneReader`: расчёт прогресса проектов остаётся каноническим, история и вехи читаются у владельцев. [Контракты](../../../../docs/platform-api/GOAL_PROJECTIONS.md).

Бортовой журнал — default-enabled plugin `projects-logbook`; ссылки на задачи читаются только через публичный Tasks `TaskReferenceReader`, а комментарий принадлежит join-связи журнала. Направленные связи проектов живут в проектном пространстве. [Контракт](../../../../docs/platform-api/PROJECT_LOGBOOK.md), [ADR-0048](../../../../docs/adr/ADR-0048-project-logbook.md).

Межмодульные операции выполняются через публичные SDK владельцев; полные доменные модули ради ссылки/команды не импортируются. [Контракты и правила](../../../../docs/platform-api/MODULE_BOUNDARY_SDKS.md).

## Центр проектов (задание 03)

- **Иерархия.** `Project.parentId` — дерево в той же таблице; дочерний проект остаётся обычным проектом. Циклы (409 `project_hierarchy_cycle` с путём `A → B → C → A`) и лимит глубины (6) проверяются сервисом до записи, под блокировкой строки пространства — иначе две встречные правки создали бы петлю. Ancestor/потомки читает `ProjectHierarchyRepository` (recursive CTE). Удаление родителя не удаляет детей (`SetNull`), `GET projects/:id` отдаёт `ancestors` и `childCount`.
- **Шаблоны.** `ProjectTemplate` — отдельная таблица и права `projects.template.*`; структура (вехи, задачи, записи журнала, дочерние проекты) — одно JSON-дерево со сдвигами в днях от стартовой даты, а не набор параллельных таблиц. `POST projects/from-template` и `POST projects/:id/duplicate` материализуют дерево в ОДНОЙ транзакции; задачи создаются публичным `TaskOperations`, вехи — `MilestoneCommands` (чужие таблицы не пишутся). Дублирование по умолчанию не копирует содержимое (`withContent: false`) и не тиражирует журнал/комментарии.
- **Портфель.** `GET projects/portfolio` — агрегаты по пространству (прогресс, открытые задачи, просрочка, риски, дедлайны, загрузка по участникам, распределение по статусам) с фильтрами `scope/status/memberId/from/to` и явными лимитами (`limit`, `page.truncated`). Данные соседей приходят провайдерами агрегатов: `openTasksByAssignee` и `milestonesWithoutDates` считают владельцы задач и вех.
- **История.** `GET projects/:id/history` — append-only `ProjectHistoryEntry` (кто/когда/какое поле, «было → стало»), пишется в транзакции самого изменения, поэтому не расходится с данными; доменные события `projects.project.updated` / `projects.project.parent_changed` публикуются параллельно. Читается из своих строк, а не из outbox (тот чистится через 7 дней). Связывание с записью журнала — `POST/DELETE projects/:id/history/:historyId/decision`: ссылка на «решение», а не копия его текста.


<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `projects` / 1.0.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `tasks`, `notes`, `calendar`, `documents`, `knowledge`, `time`, `finance` |
| Права (permissions) | `projects.project.read`, `projects.project.create`, `projects.project.update`, `projects.project.delete`, `projects.template.read`, `projects.template.create`, `projects.template.update`, `projects.template.delete`, `projects.portfolio.read`, `projects.history.read` |
| События | публикует: `projects.project.status_changed`, `projects.project.dates_changed`, `projects.milestone.completed`, `projects.milestone.dates_changed`, `projects.project.updated`, `projects.project.parent_changed`; слушает: — |
| Панели веба | `projects` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/goals`, `workspaces/:workspaceId/milestones`, `workspaces/:workspaceId/project-log`, `workspaces/:workspaceId/projects` |
| Плагины, расширяющие модуль | `projects-planning`, `projects-ideas`, `projects-problems`, `projects-logbook`, `projects-goals` |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/projects/` |
| При выключении | Панель скрывается. Проекты сохраняются; чужие сущности продолжают хранить projectId. |
<!-- generated:manifest:end -->

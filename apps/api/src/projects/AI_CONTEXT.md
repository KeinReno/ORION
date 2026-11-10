# Контекст агента: модуль projects

Сначала прочитайте `MODULE.md` рядом. Проекты как контейнер работы: статус, сроки, бюджет, ставка, вехи-соседи и привязка других сущностей по `projectId`.

Каждый метод сервиса начинается с проверки членства и идёт через `PrismaService.withUser`; ссылки на другие записи проверяются на принадлежность тому же пространству; ответы собираются `toDto`, а входы валидируются zod-схемами из `shared-types`.

Публичная проверка ссылки: `ProjectReferences` / `ProjectReferencesModule` в `public/`; возвращает boolean в исходной транзакции/RLS, без загрузки ProjectsModule. Контракт и политика потребителей: [PROJECT_REFERENCES](../../../../docs/platform-api/PROJECT_REFERENCES.md). Milestones использует тот же контракт; его HTTP остаётся за guard Projects.

Публичный `ProjectFinanceReader` / `ProjectFinanceReaderModule` в `public/` предоставляет Finance только валюту существующего проекта в исходной транзакции/RLS. Без загрузки полного ProjectsModule. [Контракт](../../../../docs/platform-api/PROJECT_FINANCE_READER.md).

Tasks использует публичные `ProjectTaskLinks` и `MilestoneReferences` для проектов и вех. Команда создания проекта остаётся в исходной транзакции задачи; SDK не загружают полные соседние модули. [Контракт](../../../../docs/platform-api/TASK_PLANNING_LINKS.md).

Goals использует `ProjectCatalog`, `GoalTaskReader` и `GoalMilestoneReader`: расчёт прогресса проектов остаётся каноническим, история и вехи читаются у владельцев. [Контракты](../../../../docs/platform-api/GOAL_PROJECTIONS.md).

Межмодульные операции выполняются через публичные SDK владельцев; полные доменные модули ради ссылки/команды не импортируются. [Контракты и правила](../../../../docs/platform-api/MODULE_BOUNDARY_SDKS.md).

<!-- generated:manifest:start -->
## Для агента (генерируется)

Блок собирается `pnpm module-docs`; руками не править.

- Точки входа: API `workspaces/:workspaceId/goals`, `workspaces/:workspaceId/milestones`, `workspaces/:workspaceId/projects` (за `@RequireModule("projects")`); панель веба `projects`; код `apps/api/src/projects/`.
- Права: `projects.project.read`, `projects.project.create`, `projects.project.update`, `projects.project.delete`.
- Модуль владеет: Проекты и их собственные поля (имя, статус, сроки, бюджет, ставка).
- Соседи: жёсткие: —; мягкие: `tasks`, `notes`, `calendar`, `documents`, `knowledge`, `time`, `finance`; чужие данные читать только через их публичный контракт, мягких соседей спрашивать через `isEnabled`.
- Расширения: плагины: `projects-planning`, `projects-ideas`, `projects-problems`, `projects-logbook`, `projects-goals`.
- Выключение модуля не удаляет данные; новые таблицы — только с ENABLE + FORCE RLS и записью в реестре снапшота.
<!-- generated:manifest:end -->

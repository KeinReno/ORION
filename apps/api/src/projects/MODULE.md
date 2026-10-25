# Проекты (`projects`)

Проекты как контейнер работы: статус, сроки, бюджет, ставка, вехи-соседи и привязка других сущностей по `projectId`.

Рядом с проектом живут обновления (`project-updates`), захваты (`project-captures`), идеи и проблемы; удаление проекта архивирует его, а не стирает историю.

Работает без задач, финансов и учёта времени — связанные показатели просто не показываются.

Публичная проверка ссылки: `ProjectReferences` / `ProjectReferencesModule` в `public/`; возвращает boolean в исходной транзакции/RLS, без загрузки ProjectsModule. Контракт и политика потребителей: [PROJECT_REFERENCES](../../../../docs/platform-api/PROJECT_REFERENCES.md). Milestones использует тот же контракт; его HTTP остаётся за guard Projects.

Публичный `ProjectFinanceReader` / `ProjectFinanceReaderModule` в `public/` предоставляет Finance только валюту существующего проекта в исходной транзакции/RLS. Без загрузки полного ProjectsModule. [Контракт](../../../../docs/platform-api/PROJECT_FINANCE_READER.md).

Tasks использует публичные `ProjectTaskLinks` и `MilestoneReferences` для проектов и вех. Команда создания проекта остаётся в исходной транзакции задачи; SDK не загружают полные соседние модули. [Контракт](../../../../docs/platform-api/TASK_PLANNING_LINKS.md).

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `projects` / 1.0.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `tasks`, `notes`, `calendar`, `documents`, `time`, `finance` |
| Права (permissions) | `projects.project.read`, `projects.project.create`, `projects.project.update`, `projects.project.delete` |
| События | публикует: —; слушает: — |
| Панели веба | `projects` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/goals`, `workspaces/:workspaceId/milestones`, `workspaces/:workspaceId/projects` |
| Плагины, расширяющие модуль | `projects-planning`, `projects-ideas`, `projects-problems`, `projects-goals` |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/projects/` |
| При выключении | Панель скрывается. Проекты сохраняются; чужие сущности продолжают хранить projectId. |
<!-- generated:manifest:end -->

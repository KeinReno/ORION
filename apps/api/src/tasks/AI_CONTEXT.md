# Контекст агента: модуль tasks

Сначала прочитайте `MODULE.md` рядом. Задачи пространства: доска и списки со сроками, подзадачами, зависимостями и сохранёнными видами.

Каждый метод сервиса начинается с проверки членства и идёт через `PrismaService.withUser`; ссылки на другие записи проверяются на принадлежность тому же пространству; ответы собираются `toDto`, а входы валидируются zod-схемами из `shared-types`.

Публичный `TaskIntegrationReader` / `TaskIntegrationReaderModule` в `public/` предоставляет проекции ссылки задачи для Time и сроков для ICS Calendar. Запросы остаются у Tasks, в исходной транзакции/RLS, без загрузки полного TasksModule. [Контракт](../../../../docs/platform-api/TASK_INTEGRATION_READER.md).

Tasks использует публичные `ProjectTaskLinks` и `MilestoneReferences` для проектов и вех. Команда создания проекта остаётся в исходной транзакции задачи; SDK не загружают полные соседние модули. [Контракт](../../../../docs/platform-api/TASK_PLANNING_LINKS.md).

<!-- generated:manifest:start -->
## Для агента (генерируется)

Блок собирается `pnpm module-docs`; руками не править.

- Точки входа: API `workspaces/:workspaceId/tasks` (за `@RequireModule("tasks")`); панель веба `tasks`; код `apps/api/src/tasks/`.
- Права: `tasks.task.read`, `tasks.task.create`, `tasks.task.update`, `tasks.task.delete`.
- Модуль владеет: Задачи, подзадачи, зависимости, сохранённые виды.
- Соседи: жёсткие: —; мягкие: `projects`, `calendar`, `time`; чужие данные читать только через их публичный контракт, мягких соседей спрашивать через `isEnabled`.
- Расширения: плагины: `team`, `tasks-saved-views`, `tasks-comments`, `tasks-kanban`, `tasks-recurrence`, `tasks-planning`.
- Выключение модуля не удаляет данные; новые таблицы — только с ENABLE + FORCE RLS и записью в реестре снапшота.
<!-- generated:manifest:end -->

# Задачи (`tasks`)

Задачи пространства: доска и списки со сроками, подзадачами, зависимостями и сохранёнными видами.

Кроме самих задач сервис ведёт комментарии (`task-comments.service.ts`) и журнал изменений статуса, исполнителя и срока (`task-activity.service.ts`). Обновление защищено ревизией (`expectedRevision`, 409 при конфликте).

Напоминания о просроченных задачах шлёт не этот модуль, а `notifications/due-task-checker.service.ts`.

Работает без проектов, календаря и учёта времени.

Синхронный публичный мост `public/task-closure-registry.ts` сообщает владельцам о переходе открытой задачи
в закрытый статус в исходной транзакции. Time регистрирует собственную остановку таймера; Tasks не читает
TimeEntry и не импортирует Time. Пустой registry допустим; ошибка handler откатывает всю команду.
Контракт и приёмка: [ADR-0027](../../../../docs/adr/ADR-0027-task-closure-bridge.md).

Публикация задачи через `TasksPublicationAdapter` передаёт только название, выбранный текст, статус и выбранный срок. Делегированное изменение статуса использует `TasksService.updateTx` с ревизией оригинала; скрытые связи, исполнители и зависимости не выдаются получателю. Общий контракт и границы: [ADR-0024](../../../../docs/adr/ADR-0024-shared-publications.md).

Публичный `TaskIntegrationReader` / `TaskIntegrationReaderModule` в `public/` предоставляет проекции ссылки задачи для Time и сроков для ICS Calendar. Запросы остаются у Tasks, в исходной транзакции/RLS, без загрузки полного TasksModule. [Контракт](../../../../docs/platform-api/TASK_INTEGRATION_READER.md).

Tasks использует публичные `ProjectTaskLinks` и `MilestoneReferences` для проектов и вех. Команда создания проекта остаётся в исходной транзакции задачи; SDK не загружают полные соседние модули. [Контракт](../../../../docs/platform-api/TASK_PLANNING_LINKS.md).

Projects использует read-only `TaskReferenceReader` для показа существующих задач в бортовом журнале. Чтение выполняется через предоставленную Projects транзакцию/RLS; контракт не предоставляет команды изменения задачи. [PROJECT_LOGBOOK](../../../../docs/platform-api/PROJECT_LOGBOOK.md).

Межмодульные операции выполняются через публичные SDK владельцев; полные доменные модули ради ссылки/команды не импортируются. [Контракты и правила](../../../../docs/platform-api/MODULE_BOUNDARY_SDKS.md).

Автопубликация Tasks использует тот же PublicationRegistry: `ruleCandidates` фильтрует
источник и формирует только разрешённую проекцию. Shared не запрашивает Task/Project.
`TasksService` пишет `tasks.task.changed` в transactional outbox при create/update/delete
и создании повторяющейся задачи. Периодическая сверка покрывает изменения вне сервиса.
Контракт: [правила публикации](../../../../docs/platform-api/PUBLICATION_RULES.md).

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `tasks` / 1.0.0 (платформа ^1.0.0) |
| Вид | базовый, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `projects`, `calendar`, `time` |
| Права (permissions) | `tasks.task.read`, `tasks.task.create`, `tasks.task.update`, `tasks.task.delete`, `tasks.status.manage`, `tasks.field.manage`, `tasks.recurrence.manage` |
| События | публикует: `tasks.task.changed`, `tasks.task.closed`, `tasks.task.updated`, `tasks.task.status_changed`, `tasks.task.bulk_applied`, `tasks.recurrence.instance_completed`, `tasks.recurrence.skipped`, `tasks.task.assigned`; слушает: `tasks.task.changed`, `tasks.task.closed` |
| Панели веба | `tasks` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/task-fields`, `workspaces/:workspaceId/task-statuses`, `workspaces/:workspaceId/task-values`, `workspaces/:workspaceId/tasks` |
| Плагины, расширяющие модуль | `team`, `tasks-saved-views`, `tasks-comments`, `tasks-kanban`, `tasks-recurrence`, `tasks-planning` |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/tasks/` |
| При выключении | Панель и API скрываются. Строки задач в базе сохраняются и вернутся при включении. |
<!-- generated:manifest:end -->

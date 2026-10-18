# Задачи (`tasks`)

Задачи пространства: доска и списки со сроками, подзадачами, зависимостями и сохранёнными видами.

Кроме самих задач сервис ведёт комментарии (`task-comments.service.ts`) и журнал изменений статуса, исполнителя и срока (`task-activity.service.ts`). Обновление защищено ревизией (`expectedRevision`, 409 при конфликте).

Напоминания о просроченных задачах шлёт не этот модуль, а `notifications/due-task-checker.service.ts`.

Работает без проектов, календаря и учёта времени.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `tasks` / 1.0.0 (платформа ^1.0.0) |
| Вид | базовый, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `projects`, `calendar`, `time` |
| Права (permissions) | — (в манифесте пока не объявлены) |
| События | публикует: —; слушает: — |
| Панели веба | `tasks` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/tasks` |
| Плагины, расширяющие модуль | `team`, `tasks-saved-views`, `tasks-comments`, `tasks-kanban`, `tasks-recurrence`, `tasks-planning` |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/tasks/` |
| При выключении | Панель и API скрываются. Строки задач в базе сохраняются и вернутся при включении. |
<!-- generated:manifest:end -->

# Календарь (`calendar`)

Календарь: события пространства, напоминания о них, входящие внешние ICS-фиды и исходящий ICS-фид по токену.

Код модуля лежит в каталоге `events/`: `events.service.ts` (события и повторения), `event-reminder.service.ts` (напоминания, каждую минуту), `calendar-connections.service.ts` (подключения ICS, каждые 30 минут), `calendar-feed.controller.ts` (исходящий фид).

Работает без задач и проектов.

Ссылку проекта проверяет `ProjectReferences`; сроки задач для исходящего ICS читает `TaskIntegrationReader` в исходной транзакции. Проверки feed token и включённости остаются у Calendar. SDK не импортируют полные TasksModule/ProjectsModule. [Контракт](../../../../docs/platform-api/TASK_INTEGRATION_READER.md).

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `calendar` / 1.0.0 (платформа ^1.0.0) |
| Вид | базовый, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `tasks`, `projects` |
| Права (permissions) | `calendar.event.read`, `calendar.event.create`, `calendar.event.update`, `calendar.event.delete` |
| События | публикует: —; слушает: — |
| Панели веба | `calendar` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/calendar`, `workspaces/:workspaceId/calendar-connections`, `workspaces/:workspaceId/events` |
| Плагины, расширяющие модуль | `calendar-external`, `calendar-widget`, `calendar-recurrence`, `calendar-reminders` |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/events/` |
| При выключении | Панель, API и фид по токену останавливаются. События сохраняются. |
<!-- generated:manifest:end -->

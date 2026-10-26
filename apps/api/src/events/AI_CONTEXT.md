# Контекст агента: модуль calendar

Сначала прочитайте `MODULE.md` рядом. Календарь: события пространства, напоминания о них, входящие внешние ICS-фиды и исходящий ICS-фид по токену.

Каждый метод сервиса начинается с проверки членства и идёт через `PrismaService.withUser`; ссылки на другие записи проверяются на принадлежность тому же пространству; ответы собираются `toDto`, а входы валидируются zod-схемами из `shared-types`.

Ссылку проекта проверяет `ProjectReferences`; сроки задач для исходящего ICS читает `TaskIntegrationReader` в исходной транзакции. Проверки feed token и включённости остаются у Calendar. SDK не импортируют полные TasksModule/ProjectsModule. [Контракт](../../../../docs/platform-api/TASK_INTEGRATION_READER.md).

Межмодульные операции выполняются через публичные SDK владельцев; полные доменные модули ради ссылки/команды не импортируются. [Контракты и правила](../../../../docs/platform-api/MODULE_BOUNDARY_SDKS.md).

<!-- generated:manifest:start -->
## Для агента (генерируется)

Блок собирается `pnpm module-docs`; руками не править.

- Точки входа: API `workspaces/:workspaceId/calendar`, `workspaces/:workspaceId/calendar-connections`, `workspaces/:workspaceId/events` (за `@RequireModule("calendar")`); панель веба `calendar`; код `apps/api/src/events/`.
- Права: `calendar.event.read`, `calendar.event.create`, `calendar.event.update`, `calendar.event.delete`.
- Модуль владеет: События, подключения календарей, исходящий ICS-фид.
- Соседи: жёсткие: —; мягкие: `tasks`, `projects`; чужие данные читать только через их публичный контракт, мягких соседей спрашивать через `isEnabled`.
- Расширения: плагины: `calendar-external`, `calendar-widget`, `calendar-recurrence`, `calendar-reminders`.
- Выключение модуля не удаляет данные; новые таблицы — только с ENABLE + FORCE RLS и записью в реестре снапшота.
<!-- generated:manifest:end -->

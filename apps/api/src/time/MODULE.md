# Время (`time`)

Учёт времени: записи затраченного времени и запущенный таймер.

Длительность не хранится, её считает `entryMinutes()` из `@orion/shared-types`. Один запущенный таймер на участника пространства обеспечивает частичный уникальный индекс в БД.

Работает без задач и проектов, но тогда записи никуда не группируются.

`TimeTaskClosureBridge` регистрируется через публичный `tasks/public/task-closure-registry.ts`.
При закрытии задачи Time сам останавливает первый найденный её работающий таймер в той же транзакции,
только в данном workspace и при включённом Time. Это синхронный bridge, не outbox-подписка; отсутствие
Tasks не мешает Time, контрактный Nest-модуль не импортирует TasksService. Поведение нескольких таймеров
одной задачи сохраняется без изменений. [ADR-0027](../../../../docs/adr/ADR-0027-task-closure-bridge.md).

Ссылки задач и их projectId читает публичный `TaskIntegrationReader`; проекты проверяет `ProjectReferences`. Оба SDK сохраняют исходную транзакцию/RLS и не импортируют полные TasksModule/ProjectsModule. Авторизация, 404 и наследование проекта остаются у Time. [Контракт](../../../../docs/platform-api/TASK_INTEGRATION_READER.md).

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `time` / 1.0.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `tasks`, `projects` |
| Права (permissions) | `time.entry.read`, `time.entry.create`, `time.entry.update`, `time.entry.delete` |
| События | публикует: —; слушает: — |
| Панели веба | `time` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/time` |
| Плагины, расширяющие модуль | `time-insights`, `time-billing` |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/time/` |
| При выключении | Панель, таймер и API останавливаются. Записи времени сохраняются. |
<!-- generated:manifest:end -->

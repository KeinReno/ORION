# Проекты (`projects`)

Проекты как контейнер работы: статус, сроки, бюджет, ставка, вехи-соседи и привязка других сущностей по `projectId`.

Рядом с проектом живут обновления (`project-updates`), захваты (`project-captures`), идеи и проблемы; удаление проекта архивирует его, а не стирает историю.

Работает без задач, финансов и учёта времени — связанные показатели просто не показываются.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `projects` / 1.0.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `tasks`, `notes`, `calendar`, `documents`, `time`, `finance` |
| Права (permissions) | — (в манифесте пока не объявлены) |
| События | публикует: —; слушает: — |
| Панели веба | `projects` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/goals`, `workspaces/:workspaceId/milestones`, `workspaces/:workspaceId/projects` |
| Плагины, расширяющие модуль | `projects-planning`, `projects-ideas`, `projects-problems`, `projects-goals` |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/projects/` |
| При выключении | Панель скрывается. Проекты сохраняются; чужие сущности продолжают хранить projectId. |
<!-- generated:manifest:end -->

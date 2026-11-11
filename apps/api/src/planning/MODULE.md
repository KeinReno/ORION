# Планирование (`planning`)

Тайм-блоки, Гантт с критическим путём и матрица «важно/срочно» — представления существующих задач.

Работает без проектов, задач и календаря: Гантт и матрица показывают пустые представления, тайм-блоки живут сами по себе. Конфликты с календарём появляются, только когда календарь включён.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `planning` / 1.0.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `tasks`, `projects`, `calendar`, `time` |
| Права (permissions) | `planning.block.read`, `planning.block.create`, `planning.block.update`, `planning.block.delete`, `planning.view.read`, `planning.preset.manage` |
| События | публикует: `planning.block.moved`; слушает: — |
| Панели веба | `planning` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/planning` |
| Плагины, расширяющие модуль | — |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/planning/` |
| При выключении | API планирования отвечает 409; тайм-блоки, пресеты и планы сохраняются, задачи и события не меняются. |
<!-- generated:manifest:end -->

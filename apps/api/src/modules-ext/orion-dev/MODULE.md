# ORION DEV (`orion-dev`)

Проверка и безопасный импорт каталога разработки в выбранное пространство.

Не требует запущенных агентов или внешнего AI API.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `orion-dev` / 1.0.0 (платформа ^1.12.0) |
| Вид | дополнительный, по умолчанию включён |
| Жёсткие зависимости | `projects`, `tasks` |
| Мягкие зависимости | — |
| Права (permissions) | `orion-dev.development_import.read`, `orion-dev.development_import.create`, `orion-dev.development_import.update`, `orion-dev.development_import.delete` |
| События | публикует: —; слушает: — |
| Панели веба | `orion-dev` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/development-import` |
| Плагины, расширяющие модуль | — |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/modules-ext/orion-dev/` |
| При выключении | Скрывает панель и закрывает API импорта; проекты, задачи и сопоставления сохраняются. |
<!-- generated:manifest:end -->

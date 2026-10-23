# База знаний (`knowledge`)

Материалы со статусом, источниками и связями. Это не заметки.

Работает без заметок, документов и задач.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `knowledge` / 1.0.0 (платформа ^1.0.0) |
| Вид | базовый, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `notes`, `documents` |
| Права (permissions) | `knowledge.item.read`, `knowledge.item.create`, `knowledge.item.update`, `knowledge.item.delete` |
| События | публикует: —; слушает: — |
| Панели веба | `knowledge` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/knowledge` |
| Плагины, расширяющие модуль | — |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/knowledge/` |
| При выключении | Панель и API скрываются. Материалы, источники и связи сохраняются. |
<!-- generated:manifest:end -->

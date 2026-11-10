# База знаний (`knowledge`)

Материалы со статусом, источниками и связями. Это не заметки.

Работает без заметок, документов, проектов и задач. Привязка материала к проекту необязательна.

Связь с проектом хранится как nullable `projectId` и проверяется через публичный `ProjectReferences`; Knowledge не читает внутренние сервисы Projects. Если проект удалён, связь очищается, сам материал и его коллекция остаются.

Публикация через `KnowledgePublicationAdapter` передаёт название и, по выбору автора, body как обычный текст. Summary, sources, attachments, categories и relations не передаются. Независимая копия создаётся как private/draft, чужое редактирование оригинала этим адаптером не поддерживается. Общий контракт и границы: [ADR-0024](../../../../docs/adr/ADR-0024-shared-publications.md).

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `knowledge` / 1.0.0 (платформа ^1.0.0) |
| Вид | базовый, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `notes`, `documents`, `projects` |
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

# Контекст агента: модуль documents

Сначала прочитайте `MODULE.md` рядом. Файлы и папки пространства: дерево по `parentId`, версии, превью, загрузка и потоковая отдача с `Range`.

Каждый метод сервиса начинается с проверки членства и идёт через `PrismaService.withUser`; ссылки на другие записи проверяются на принадлежность тому же пространству; ответы собираются `toDto`, а входы валидируются zod-схемами из `shared-types`.

<!-- generated:manifest:start -->
## Для агента (генерируется)

Блок собирается `pnpm module-docs`; руками не править.

- Точки входа: API `workspaces/:workspaceId/documents` (за `@RequireModule("documents")`); панель веба `documents`; код `apps/api/src/documents/`.
- Права: `documents.document.read`, `documents.document.create`, `documents.document.update`, `documents.document.delete`.
- Модуль владеет: Документы, версии, превью, хранилище файлов.
- Соседи: жёсткие: —; мягкие: `notes`, `projects`; чужие данные читать только через их публичный контракт, мягких соседей спрашивать через `isEnabled`.
- Расширения: плагины: `documents-history`, `documents-resources`, `documents-office`.
- Выключение модуля не удаляет данные; новые таблицы — только с ENABLE + FORCE RLS и записью в реестре снапшота.
<!-- generated:manifest:end -->

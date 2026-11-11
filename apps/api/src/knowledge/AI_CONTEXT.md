# Контекст агента: модуль knowledge

Сначала прочитайте `MODULE.md` рядом. Материалы со статусом, источниками и связями. Это не заметки.

Каждый метод сервиса начинается с проверки членства и идёт через `PrismaService.withUser`; ссылки на другие записи проверяются на принадлежность тому же пространству; ответы собираются `toDto`, а входы валидируются zod-схемами из `shared-types`.

Необязательная связь с проектом проверяется через публичный `ProjectReferences` в той же транзакции. При выключенном Projects библиотека остаётся доступной; связь можно не задавать.

Проверка материала — хранимое состояние + `lastVerifiedAt`/`verifiedById`; вычисляемое `outdated` считается по `KnowledgeSettings.verificationDays`. Правка содержимого снимает подтверждение, `verify` публикует `knowledge.item.verification.changed`. Поиск идёт по `searchVector` (триггер, конфигурация russian, текст в нижнем регистре из-за локали C). История — `KnowledgeItemRevision` (снимки и восстановление без перезаписи). Входящие читаются через публичный `InboxItems`, файлы Documents — через `readKnowledgeSourceTitle`; агентные инструменты ждут `knowledge.item.read`.

<!-- generated:manifest:start -->
## Для агента (генерируется)

Блок собирается `pnpm module-docs`; руками не править.

- Точки входа: API `workspaces/:workspaceId/knowledge` (за `@RequireModule("knowledge")`); панель веба `knowledge`; код `apps/api/src/knowledge/`.
- Права: `knowledge.item.read`, `knowledge.item.create`, `knowledge.item.update`, `knowledge.item.delete`.
- Модуль владеет: Разделы, материалы, источники и связи между материалами.
- Соседи: жёсткие: —; мягкие: `notes`, `documents`, `projects`; чужие данные читать только через их публичный контракт, мягких соседей спрашивать через `isEnabled`.
- Расширения: плагины: —.
- Выключение модуля не удаляет данные; новые таблицы — только с ENABLE + FORCE RLS и записью в реестре снапшота.
<!-- generated:manifest:end -->

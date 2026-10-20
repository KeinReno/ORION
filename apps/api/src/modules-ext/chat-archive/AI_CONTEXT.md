# Контекст агента: модуль chat-archive

Сначала прочитайте `MODULE.md` рядом. Архив чатов: записи пространства (заготовка — опишите модуль).

Каждый метод сервиса начинается с проверки членства и идёт через `PrismaService.withUser`; ссылки на другие записи проверяются на принадлежность тому же пространству; ответы собираются `toDto`, а входы валидируются zod-схемами из `shared-types`.

<!-- generated:manifest:start -->
## Для агента (генерируется)

Блок собирается `pnpm module-docs`; руками не править.

- Точки входа: API `workspaces/:workspaceId/chat-archive` (за `@RequireModule("chat-archive")`); панель веба `chat-archive`; код `apps/api/src/modules-ext/chat-archive/`.
- Права: `chat-archive.conversation.read`, `chat-archive.conversation.create`, `chat-archive.conversation.update`, `chat-archive.conversation.delete`.
- Модуль владеет: Личный архив разговоров каждого участника: разговор (источник, id сессии, проект, заголовок) и строки его транскрипта — исходная строка и извлечённый текст.
- Соседи: жёсткие: —; мягкие: —; чужие данные читать только через их публичный контракт, мягких соседей спрашивать через `isEnabled`.
- Расширения: плагины: —.
- Выключение модуля не удаляет данные; новые таблицы — только с ENABLE + FORCE RLS и записью в реестре снапшота.
<!-- generated:manifest:end -->

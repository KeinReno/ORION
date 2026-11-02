# Контекст агента: модуль orion-dev

Сначала прочитайте `MODULE.md` рядом. Проверка и безопасный импорт каталога разработки в выбранное пространство.

Каждый метод сервиса начинается с проверки членства и идёт через `PrismaService.withUser`; ссылки на другие записи проверяются на принадлежность тому же пространству; ответы собираются `toDto`, а входы валидируются zod-схемами из `shared-types`.

<!-- generated:manifest:start -->
## Для агента (генерируется)

Блок собирается `pnpm module-docs`; руками не править.

- Точки входа: API `workspaces/:workspaceId/development-import` (за `@RequireModule("orion-dev")`); панель веба `orion-dev`; код `apps/api/src/modules-ext/orion-dev/`.
- Права: `orion-dev.development_import.read`, `orion-dev.development_import.create`, `orion-dev.development_import.update`, `orion-dev.development_import.delete`.
- Модуль владеет: Обзор разработки и интерфейс проверки импорта; задачи и проекты принадлежат существующим модулям.
- Соседи: жёсткие: `projects`, `tasks`; мягкие: —; чужие данные читать только через их публичный контракт, мягких соседей спрашивать через `isEnabled`.
- Расширения: плагины: —.
- Выключение модуля не удаляет данные; новые таблицы — только с ENABLE + FORCE RLS и записью в реестре снапшота.
<!-- generated:manifest:end -->

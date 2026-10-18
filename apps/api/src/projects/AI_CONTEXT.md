# Контекст агента: модуль projects

Сначала прочитайте `MODULE.md` рядом. Проекты как контейнер работы: статус, сроки, бюджет, ставка, вехи-соседи и привязка других сущностей по `projectId`.

Каждый метод сервиса начинается с проверки членства и идёт через `PrismaService.withUser`; ссылки на другие записи проверяются на принадлежность тому же пространству; ответы собираются `toDto`, а входы валидируются zod-схемами из `shared-types`.

<!-- generated:manifest:start -->
## Для агента (генерируется)

Блок собирается `pnpm module-docs`; руками не править.

- Точки входа: API `workspaces/:workspaceId/goals`, `workspaces/:workspaceId/milestones`, `workspaces/:workspaceId/projects` (за `@RequireModule("projects")`); панель веба `projects`; код `apps/api/src/projects/`.
- Права: `projects.project.read`, `projects.project.create`, `projects.project.update`, `projects.project.delete`.
- Модуль владеет: Проекты и их собственные поля (имя, статус, сроки, бюджет, ставка).
- Соседи: жёсткие: —; мягкие: `tasks`, `notes`, `calendar`, `documents`, `time`, `finance`; чужие данные читать только через их публичный контракт, мягких соседей спрашивать через `isEnabled`.
- Расширения: плагины: `projects-planning`, `projects-ideas`, `projects-problems`, `projects-goals`.
- Выключение модуля не удаляет данные; новые таблицы — только с ENABLE + FORCE RLS и записью в реестре снапшота.
<!-- generated:manifest:end -->

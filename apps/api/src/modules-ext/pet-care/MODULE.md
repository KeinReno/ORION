# Pet Care — образец модуля, подключённого манифестом

Питомцы (имя, вид, день рождения, заметки) и журнал ухода (кормление, ветеринар, лекарство, прогулка). Модуль включён
по умолчанию (подробности — в [`docs/platform-api/MODULE_REGISTRY.md`](../../../../../docs/platform-api/MODULE_REGISTRY.md)).

## Как добавить свой модуль по этому образцу

1. Выберите `<id>` в kebab-case (например, `plants`). Создайте каталоги:
   - `apps/api/src/modules-ext/<id>/` — `module.manifest.json`, `<id>.module.ts`, контроллер, сервис,
     `prisma/models.prisma` (модели с `workspaceId`, `@@map`, связь с `Workspace`), `prisma/migration.sql`;
   - `apps/web/modules-ext/<id>/` — панель (`export function XPanel`);
   - `packages/shared-types/src/modules-ext/<id>/index.ts` — zod-схемы (ответы без `.default`, входные — с ним);
   - `apps/api/test/modules-ext/<id>/` — интеграционный тест (CRUD, изоляция второго пользователя, 409 при выключении).
2. Заполните `module.manifest.json` по образцу из этого каталога: `catalog` (запись `MODULE_CATALOG`), `permissions`,
   `api` (Nest-модуль, `probePath`), `web.panel`, `prisma` (фрагмент, обратные поля `Workspace`, миграции),
   `data.models` (политика снапшота и класс синхронизации **каждой** модели — с причиной).
3. Миграция: таблицы + `ENABLE`/`FORCE ROW LEVEL SECURITY` + `CREATE POLICY` (шаблон — `prisma/migration.sql` здесь).
   Имя вида `ГГГГММДДЧЧММСС_имя`, правки вносите в исходник в каталоге модуля, копия в `apps/api/prisma/migrations/` генерируется.
4. `pnpm module-registry`, затем `pnpm db:generate`, `pnpm --filter @orion/api prisma:migrate:deploy`.
5. Проверьте: `pnpm typecheck && pnpm lint && pnpm test && pnpm architecture-check`, `pnpm test:integration`.

Сервис модуля соблюдает инварианты обычного модуля (CLAUDE.md): `assertMemberTx` первым, всё внутри `withUser`, DTO
собирается руками (`toPetDto`), ссылка на питомца проверяется на принадлежность этому же пространству, контроллер несёт
`@RequireModule("<id>")`. Выключение модуля не удаляет данные.

## Что трогает подключение этого модуля

Только: эти каталоги, `apps/api/prisma/migrations/20261018120000_pet_care/`, области между маркерами в
`schema.prisma` и `*.generated.ts`. Проверка: `node scripts/module-registry.mjs --check-diff <base>`.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `pet-care` / 1.0.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | — |
| Права (permissions) | `pet-care.pet.read`, `pet-care.pet.create`, `pet-care.pet.update`, `pet-care.pet.delete` |
| События | публикует: —; слушает: — |
| Панели веба | `pet-care` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/pet-care` |
| Плагины, расширяющие модуль | — |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/modules-ext/pet-care/` |
| При выключении | Панель и API скрываются. Питомцы и записи ухода сохраняются и вернутся при включении. |
<!-- generated:manifest:end -->

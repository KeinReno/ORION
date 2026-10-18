# Подключение модуля каталогом с манифестом (G5, G10)

Модуль подключается **добавлением своих каталогов**; файлы ядра при этом не правятся. Единственное общее, что
меняется, — автогенерируемые файлы реестра. Образец и приёмочный пример — Pet Care
(`apps/api/src/modules-ext/pet-care/`), пошаговая инструкция — [`MODULE.md`](../../apps/api/src/modules-ext/pet-care/MODULE.md).
Скелет нового модуля создаёт `pnpm create:module <id> --label "…"`; разбор шагов и критерии приёмки — [`docs/DEV_KIT.md`](../DEV_KIT.md).

## Раскладка

| Что | Где |
|---|---|
| Манифест (единственная точка обнаружения) | `apps/api/src/modules-ext/<id>/module.manifest.json` |
| Nest-модуль, контроллер, сервис; фрагмент Prisma `prisma/models.prisma`; миграция `prisma/*.sql` | `apps/api/src/modules-ext/<id>/` |
| Панель и хуки | `apps/web/modules-ext/<id>/` |
| Zod-контракты (`index.ts`) | `packages/shared-types/src/modules-ext/<id>/` |
| Интеграционные тесты | `apps/api/test/modules-ext/<id>/` |

`<id>` — kebab-case, совпадает с именем каталога, не пересекается с `CORE_MODULE_IDS` (`modules.ts`).

## Что генерирует `scripts/module-registry.mjs`

| Файл | Содержимое | Кто читает |
|---|---|---|
| `packages/shared-types/src/modules-ext/registry.generated.ts` | `GENERATED_MODULE_IDS`, `GENERATED_MODULE_CATALOG`, `GENERATED_PRIMARY_RESOURCES`, реэкспорт схем модуля | `modules.ts` (`ORION_MODULE_IDS`, `MODULE_CATALOG`), `permissions.ts`, `index.ts` |
| `apps/api/src/modules-ext/modules.generated.ts` | `GENERATED_NEST_MODULES` | `app.module.ts` |
| `apps/api/src/modules-ext/data.generated.ts` | `GENERATED_SNAPSHOT_REGISTRY`, `GENERATED_SNAPSHOT_SPECS`, `GENERATED_SYNC_CLASSIFICATION`, `GENERATED_MODULE_PROBES` | `snapshot-registry.ts`, `snapshot.service.ts`, `sync-classification.ts`, матричный тест модулей |
| `apps/web/modules-ext/panels.generated.ts` | `generatedPanelDefinitions` | `panel-registry.ts` |
| `scripts/module-ownership.generated.mjs` | `GENERATED_MODEL_OWNERS` (владелец `modules-ext`) | `module-ownership.mjs` (правило границ G4) |
| `apps/api/prisma/schema.prisma` | только области между `// <module-registry:…>` (модели и обратные поля `Workspace`) | Prisma |
| `apps/api/prisma/migrations/<name>/migration.sql` | байтовая копия миграции модуля | `prisma migrate` |

Команды: `pnpm module-registry` — записать; `pnpm module-registry --check` — сверить (вызывается из `pnpm architecture-check`);
`node scripts/module-registry.mjs --check-diff <base>` — если изменения `base..HEAD` добавили манифест, они не вправе трогать
файлы ядра (допустимы каталоги модуля, его миграция, генерируемые файлы, область схемы и `docs/`).

Закрытые `z.enum` остаются закрытыми: `ORION_MODULE_IDS = [...CORE_MODULE_IDS, ...GENERATED_MODULE_IDS]`, произвольная
строка не принимается. Существующие 15 модулей не мигрированы и живут в `modules.ts`/`panel-registry.ts` как раньше.

## Что проверяет генератор

Валидность манифеста (id, каталог, файлы по путям, `panelId`), уникальность id/моделей/миграций, что каждая модель из
фрагмента Prisma описана в `data.models` (политика снапшота и класс синхронизации обязательны), имеет `workspaceId` и
`@@map`, а миграции модуля содержат `ENABLE` + `FORCE ROW LEVEL SECURITY` и `CREATE POLICY` для каждой таблицы.
Дальше — штатные структурные тесты: сверка реестра снапшота со `schema.prisma` на старте, `api-rls` (RLS у каждой таблицы
с `workspaceId`), `sync-classification.test.ts`.

## Что сделано и что осталось

Сделано: подключение серверной части (Nest-модуль, `@RequireModule`), каталога/enum, панели, прав (основной ресурс),
политики бэкапа и класса синхронизации, миграции с RLS — манифестом. Тесты: `scripts/module-registry.test.mjs`
(фикстура-модуль без правок ядра), `apps/api/test/modules-ext/pet-care/pet-care.integration.test.ts`.

Не сделано (остаток G5/G10):

- **Prisma-схема остаётся одним файлом.** Модели модуля копируются в области `schema.prisma` между маркерами; многофайловая
  схема (`prismaSchemaFolder`, preview в Prisma 5.22) не включена — это перенос всей схемы и скриптов, вне образца.
  Обратное поле в `Workspace` тоже вставляется генератором (Prisma требует его).
- **Состояние «по умолчанию» новых пространств.** `Workspace.disabledModules` имеет значение по умолчанию в схеме
  (`["markets","health"]`), поэтому модуль, подключённый манифестом, **включён во всех пространствах**, а
  `catalog.defaultEnabled: false` пока ничего не делает. Pet Care включён по умолчанию.
- Клиент модуля ходит через `ApiClient.extensionRequest` (G24 не закрыт полностью); сервер не читает манифесты в рантайме —
  регистрация происходит при генерации, а не при установке (G6: install/uninstall/export).
- Генератор не создаёт DDL (таблицы, индексы, ключи пишутся вручную по образцу). **RLS — создаёт:** `"rls": "workspace-member"` у
  миграции в манифесте дописывает `ENABLE` + `FORCE ROW LEVEL SECURITY` и политику `<таблица>_isolation` для каждой созданной
  в ней таблицы модуля (`workspaceMemberRlsBlock`); ручной RLS рядом с шаблоном — ошибка. Без `rls` проверка наличия RLS в файле остаётся.
  Для Pet Care результат байт-в-байт равен ранее применённой миграции (иначе у Prisma разойдётся контрольная сумма).
- Не подключены: `scripts/module-ownership.mjs` (G4), права `@RequirePermission`, события модуля.

# Комплект разработчика ORION (G15, сценарий Б)

Как добавить в платформу **свой модуль**, не правя файлы ядра. Опирается на подключение модуля манифестом
([`platform-api/MODULE_REGISTRY.md`](platform-api/MODULE_REGISTRY.md), G5/G10); образец полного модуля —
`apps/api/src/modules-ext/pet-care/`.

Статус: закрыт частично (18.10.2026). Есть генератор модуля и тест, что скелет проходит проверки платформы. Нет генератора
плагинов и не прогнан эксперимент «агент по этой документации создаёт образец» — см. раздел «Чего в комплекте нет».

## Быстрый путь

```bash
pnpm create:module plants --label "Растения" --dry-run   # только список файлов, ничего не пишет
pnpm create:module plants --label "Растения"             # создать скелет, пересобрать реестр и документы
pnpm db:generate                                          # Prisma-клиент с новой моделью
```

Скрипт — `scripts/create-module.mjs`. Он:

1. проверяет `<id>`: kebab-case (строчные латинские буквы и цифры через дефис, начинается с буквы, до 40 символов), не занят
   модулем ядра (`CORE_MODULE_IDS`), другим модулем из `modules-ext`, плагином (`ORION_PLUGIN_IDS`, каталог в
   `apps/web/plugins`) или каталогом `apps/api/src`; модель `<Id>Item` и таблица `<id>_items` не должны уже быть в
   `schema.prisma`;
2. **отказывается перезаписывать**: если любой из четырёх каталогов модуля уже есть, не пишет ничего и объясняет почему;
3. создаёт файлы (таблица ниже) в раскладке образца;
4. запускает `scripts/module-registry.mjs` (генерируемые файлы, область схемы, копия миграции) и
   `scripts/module-docs.mjs` (`AI_CONTEXT.md` и генерируемый блок `MODULE.md`).

Метка миграции — текущее время UTC, но не раньше последней существующей миграции (иначе Prisma применит её не в том порядке).

## Что создаётся

| Файл | Зачем |
|---|---|
| `apps/api/src/modules-ext/<id>/module.manifest.json` | единственная точка обнаружения: запись каталога (`label`, `summary`, `owns`, `disableBehavior`…), `permissions.primaryResource`, Nest-модуль, `probePath`, панель, Prisma-фрагмент и миграция, `data.models` (политика снапшота и класс синхронизации **каждой** модели) |
| `<id>.module.ts`, `<id>.controller.ts`, `<id>.service.ts` | Nest-часть: `@RequireModule("<id>")`, маршрут `workspaces/:workspaceId/<id>`, входы через `ZodValidationPipe`, в сервисе `assertMemberTx` первым и всё внутри `withUser` (RLS), ссылка на запись проверяется на принадлежность этому же пространству, наружу `toDto` |
| `prisma/models.prisma` | модель `<Id>Item`: `workspaceId`, `@@map`, связь с `Workspace` (`onDelete: Cascade`), `@@index([workspaceId])` |
| `prisma/migration.sql` | таблица + `ENABLE` и `FORCE ROW LEVEL SECURITY` + `CREATE POLICY`; копия в `apps/api/prisma/migrations/<метка>_<id>/` генерируется, правьте этот исходник |
| `MODULE.md`, `AI_CONTEXT.md` | описание и контекст для агента; блок между маркерами `generated:manifest` собирает `module-docs`, остальное пишете вы |
| `apps/web/modules-ext/<id>/<Id>Panel.tsx`, `use-<id>.ts` | панель на `PanelShell`/`PanelHeader`/`PanelBody` из `@orion/ui`, строки по-русски, состояния «загрузка / ошибка / пусто / нет пространства»; хуки через `ApiClient.extensionRequest`, ключи кэша `["<id>", ...]` |
| `packages/shared-types/src/modules-ext/<id>/index.ts` | zod-контракты: схема ответа (без `.default`), входные схемы create/update (с `.default`), схема «204 без тела» |
| `apps/api/test/modules-ext/<id>/<id>.integration.test.ts` | интеграционный тест: регистрация через сгенерированные реестры, CRUD, изоляция второго пользователя (API и RLS), 409 при выключенном модуле и сохранность данных |

Изменяются только генерируемые файлы реестра (`*.generated.ts`, `scripts/module-ownership.generated.mjs`), области между
маркерами `// <module-registry:…>` в `schema.prisma` и копия миграции. Это проверяет `scripts/create-module.test.mjs`
и `node scripts/module-registry.mjs --check-diff <base>`.

## Шаг за шагом

1. **Создайте скелет**: `pnpm create:module <id> --label "Название"`. Скелет рабочий сразу: список записей с заголовком и
   заметкой.
2. **Замените заготовку предметной областью.** Модель `<Id>Item` — заглушка. Пока миграция не применена на общей БД и не влита,
   правьте `prisma/models.prisma` и `prisma/migration.sql`, затем `data.models` в манифесте (имя модели, `delegate`,
   `snapshotKey`, `reason`, `sync`), контракт, сервис, панель, тест. Каждая новая таблица с `workspaceId` обязана иметь `ENABLE` +
   `FORCE ROW LEVEL SECURITY` и политику — генератор реестра и структурный тест `api-rls` это проверяют.
3. **Заполните манифест**: `catalog.summary/owns/livesWithout/provides/disableBehavior` — реальными формулировками;
   `optionalDependencies` — id модулей, которые вы читаете (через их публичный контракт, а не через их таблицы).
4. **Пересоберите реестр**: `pnpm module-registry`, затем `pnpm db:generate`. Применять миграцию на свою локальную БД:
   `pnpm --filter @orion/api prisma:migrate:deploy`. Общую БД разработчика не сбрасывайте.
5. **Пишите по инвариантам** (`CLAUDE.md`): ссылка на чужой объект проверяется на принадлежность тому же пространству;
   чужие таблицы напрямую не трогаются (правило границ модулей, G4); выключение модуля не удаляет данные; продюсеры
   уведомлений спрашивают `NotificationPolicyService`.
6. **Обновите документы**: `pnpm module-docs`; в `MODULE.md` опишите смысл модуля.
7. **Прогоните проверки приёмки** (ниже).

## Критерии приёмки

Модуль принят, когда зелёные:

| Проверка | Команда | Что доказывает |
|---|---|---|
| Типы | `pnpm typecheck` | контракт, сервис, хуки и панель согласованы (включая `apps/api/test`) |
| Линт | `pnpm lint` | 0 ошибок |
| Юнит-тесты | `pnpm test` | в том числе `scripts/module-registry.test.mjs`, `scripts/create-module.test.mjs`, сверка реестра с диском |
| Архитектура | `pnpm architecture-check` | границы импортов, правило «сервис модуля не трогает чужие таблицы», актуальность реестра |
| Реестр | `node scripts/module-registry.mjs --check` | манифест валиден, генерируемые файлы и копия миграции актуальны, в миграции есть RLS |
| Изменение только модуля | `node scripts/module-registry.mjs --check-diff <base>` | добавление модуля не затронуло файлы ядра |
| Документы | `node scripts/module-docs.mjs --check` (`pnpm module-docs:check`) | `MODULE.md`/`AI_CONTEXT.md` существуют и актуальны |
| Интеграция | `pnpm test:integration` (нужны `pnpm db:up` и применённые миграции) | CRUD, изоляция пространств и RLS, 409 при выключении, реестр снапшота против `schema.prisma` |

E2E (`pnpm test:e2e:local`) для модуля не обязателен, но панель стоит открыть руками в `pnpm dev:web`.

## Чего в комплекте нет

- **Генератора плагинов (`create:plugin`).** Регистрация плагина пока не управляется данными: нужно вручную править
  `ORION_PLUGIN_IDS` и каталог плагинов в `packages/shared-types/src/plugins.ts`, `apps/web/plugins/index.ts`
  (вызовы `contribute(...)`) и, если нужен новый слот, `SlotContracts` в `apps/web/lib/extensions/contracts.ts`; проверка
  `pluginCatalogViolations` сверяет эти места между собой. Скаффолдер, правящий их, нарушил бы принцип «ядро не правится
  при подключении». Нужна G5-подобная схема «манифест плагина обнаруживается каталогом» — отдельная задача.
- **Валидатора манифеста как отдельной команды.** Валидацию выполняет `scripts/module-registry.mjs` (в том числе
  `--check`); отдельного CLI нет.
- **Эксперимента «агент по этой документации создаёт образец, CI зелёный».** Не проводился (решение владельца: не сейчас).
  Критерий G15 в этой части остаётся открытым.
- Скелет — один ресурс с двумя полями; связей между сущностями, фоновых задач, уведомлений, событий и плагинов-расширений
  в нём нет: их добавляют по образцам соответствующих модулей и ADR.

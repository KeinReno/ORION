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
| `apps/web/modules-ext/<id>/<Id>Panel.tsx`, `use-<id>.ts` | панель на `PanelShell`/`PanelHeader`/`PanelBody` из `@orion/ui`, строки по-русски, состояния «загрузка / ошибка / пусто / нет пространства»; хуки через `createModuleClient` (`@orion/core`, поверх `ApiClient.extensionRequest`), ключи кэша `["<id>", ...]` |
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

## Свой плагин интерфейса (манифест)

Плагин, который только добавляет компоненты в существующие слоты хоста, подключается без правки файлов ядра:

```
apps/web/plugins-ext/<id>/plugin.manifest.json
apps/web/plugins-ext/<id>/<Компонент>.tsx
```

```json
{
  "id": "habits-insights",
  "version": "1.0.0",
  "extends": "habits",
  "catalog": { "label": "…", "summary": "…", "provides": ["…"], "disableBehavior": "…", "defaultEnabled": true },
  "web": { "contributions": [{ "slot": "habits.insights", "file": "insights", "export": "HabitsInsights" }] },
  "surfaces": []
}
```

- `extends` — модуль ядра или модуль из `modules-ext`; плагин выключается вместе с ним.
- `slot` — ключ `SlotContracts` (`apps/web/lib/extensions/contracts.ts`); компонент получает пропсы этого слота. Слотам из
  `SlotMeta` (вкладки и т.п.) нужен `meta`, остальным он запрещён. `order` — место среди вкладов слота.
- Код плагина обращается к хосту только через `lib/extensions/contracts` и `lib/extensions/host-api`, а также пакеты
  `@orion/*`; цвета — токенами темы. Это проверяет `scripts/architecture-check.mjs`, как и для плагинов основной сборки.

### Новые места: панель, карточка дашборда, раздел настроек, команда

Кроме вкладов в существующие слоты плагин может **добавить** свои места (ADR-0022, E1) — в `web` манифеста:

```json
"panels":   [{ "id": "usage", "label": "Расход ИИ", "icon": "Coins", "group": "Работа", "file": "UsagePanel", "export": "UsagePanel" }],
"widgets":  [{ "id": "today", "title": "Расход за сегодня", "file": "TodayCard", "export": "TodayCard" }],
"settings": [{ "id": "keys", "label": "Расход ИИ", "file": "KeysSettings", "export": "KeysSettings" }],
"commands": [{ "id": "refresh", "label": "Обновить расход ИИ", "icon": "RefreshCw", "file": "commands", "export": "refresh" }]
```

- **Панель** — пункт меню (группа `group`, по умолчанию «Расширения») и вкладка дока `ext:<plugin>.<id>`; открывается рядом и
  отдельным окном (`/panel/ext?instance=<plugin>.<id>`). Компонент получает `ExtensionPanelProps` (`workspaceId`, `setTitle`).
- **Виджет** — карточка на дашборде с заголовком `title`; **раздел настроек** — вкладка в группе «Расширения» панели
  настроек. Оба получают `ExtensionPlaceProps` (`workspaceId`).
- **Команда** — пункт Ctrl+K в группе «Расширения»; `export` — функция `(context: { workspaceId }) => void | Promise<void>`.
- `id` — kebab-case, уникален внутри плагина и вида; `order` — порядок; иконки — имена `lucide-react`. Типы пропсов —
  из `lib/extensions/contracts`. Всё добавленное исчезает, когда плагин выключен; открытая вкладка панели объясняет это.
- Хост мест: `lib/extensions/places.ts` (хранилище, работает во время выполнения) и `places-host.tsx`.

После добавления каталога — `pnpm module-registry`: генератор (`scripts/plugin-registry.mjs`) дописывает плагин в
`GENERATED_PLUGIN_IDS`/каталог (`packages/shared-types/src/plugins-ext/registry.generated.ts`) и в вклады слотов
(`apps/web/plugins-ext/contributions.generated.ts`). Плагин появляется в «Настройки → Плагины» и включается/выключается для
пространства, как любой другой. `pnpm module-registry --check-diff <base>` подтверждает, что добавление плагина не тронуло
файлов ядра. Образец — `apps/web/plugins-ext/habits-insights/`, e2e — `e2e/plugins-ext.spec.ts`.

## Расширение из папки — без пересборки ORION

Для быстрого «своего» расширения на установленной программе (ADR-0022, E2). Нужны только этот репозиторий (для сборки)
и установленный ORION.

```bash
pnpm orion-ext init ai-tokens --name "Расход токенов ИИ"   # создаёт и собирает Документы\ORION\Расширения\ai-tokens
pnpm orion-ext build "<папка расширения>" --watch          # пересобирать на каждую правку src/index.tsx
```

1. ORION сам замечает папку (опрос раз в 2 с). «Настройки → Этот компьютер → Расширения» — карточка «ждёт подтверждения»
   с разрешениями; «Подтвердить и включить» (владелец хотя бы одного пространства). Подтверждение — на всю установку.
2. Код загружается в работающее окно: `activate(ctx)` регистрирует места через `ctx.addPanel / addWidget / addSettings /
   addCommand` — те же панель, карточка, раздел настроек и команда, что у плагинов из `plugins-ext`. Всё снимается само
   при выключении, удалении и перезагрузке.
   `ctx.contribute(slot, { component, order?, meta? })` — вклад в слот ядра (`"habits.insights"`, `"finance.tabs"`…, список —
   `CORE_SLOT_NAMES` в `lib/extensions/contracts.ts`; опечатка в имени слота ядра — ошибка активации) или в слот другого
   расширения (`"ai-tokens.cards"`). `ctx.slot("cards")` — свой слот: компонент, который рисует вклады других расширений в
   `<id>.cards` и передаёт им свои пропсы.
3. Поменяли код после подтверждения — статус «файлы изменились», код не грузится, пока не подтвердите снова. Пока правите,
   включите «Режим разработчика»: новая сборка подхватывается за ~2 с без подтверждения и перезапуска.

Что доступно коду (`__ORION_SDK__`, `apps/web/lib/extensions/runtime/sdk.ts`): `react`, `@orion/ui`, `@orion/core-react`
(данные с правами пользователя) и `@orion/sdk` = `lib/extensions/host-api.ts` (виртуальный модуль, отдельный пакет планируется (G24)). В бандл они не попадают; прочие пакеты
(иконки `lucide-react`) — попадают. Манифест — `orion.extension.json` (`id` = имя папки, `version`, `engines.orion`,
`entry`, `permissions`), схема — `extensionManifestSchema` в `packages/shared-types/src/extensions.ts`.

**Данные, секреты, сеть (E3)** — через `ctx`, только то, что объявлено в `permissions` манифеста:

- `ctx.storage.list / get / put / remove(workspaceId, collection, key[, data])` — JSON-записи внутри пространства (нужно
  `"storage": true`; до 64 КБ на запись, 5000 записей на расширение в пространстве). Видны участникам пространства (RLS),
  входят в его резервную копию, переживают выключение расширения.
- `ctx.secrets.status / set / clear` — личные секреты пользователя из `permissions.secrets` (например, API-ключ);
  зашифрованы на сервере, значение интерфейсу не возвращается. Задаются и в карточке расширения в настройках.
- `ctx.fetch(workspaceId, { url, method, headers, body })` — https-запрос к хосту из `permissions.network` через сервер
  (DNS-защита, без редиректов, до 2 МБ ответа); `"Authorization": "Bearer {{secret:api_key}}"` — сервер подставит секрет.
  Служебные заголовки (`Host`, `Content-Length`…) задаёт сервер.

**По пространствам (E5).** Подтверждение — на всю установку, но владелец пространства может выключить расширение у
себя (карточка расширения → «Включено в «…»»): в этом пространстве код не загружается, а хранилище и сеть отвечают 409.

Ограничения сейчас: своих таблиц нет, расписаний и серверного кода нет, файлы других
программ на компьютере расширению недоступны. В режиме сервера (без `ORION_EXTENSIONS=on`) и на клиенте LAN расширения выключены. Всё API
расширений отвечает только запросам с этого компьютера. Подтверждения — `extensions.json` в каталоге узла
(`ORION_NODE_DIR`), папка — `ORION_EXTENSIONS_DIR`.

## Чего в комплекте нет

- **Генератора плагинов (`create:plugin`) и плагинов с серверной частью по манифесту.** Плагин интерфейса подключается
  манифестом (раздел ниже), но скелет для него пока создаётся руками по образцу `habits-insights`. Плагин с серверной частью
  (`@RequirePlugin`, свои таблицы) по-прежнему регистрируется вручную в `plugins.ts`, `apps/web/plugins/index.ts` и
  `apps/api/src`. Новый слот — правка `SlotContracts` в ядре.
- **Валидатора манифеста как отдельной команды.** Валидацию выполняет `scripts/module-registry.mjs` (в том числе
  `--check`); отдельного CLI нет.
- **Эксперимента «агент по этой документации создаёт образец, CI зелёный».** Не проводился (решение владельца: не сейчас).
  Критерий G15 в этой части остаётся открытым.
- Скелет — один ресурс с двумя полями; связей между сущностями, фоновых задач, уведомлений, событий и плагинов-расширений
  в нём нет: их добавляют по образцам соответствующих модулей и ADR.

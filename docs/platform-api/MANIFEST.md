# Манифест компонента (Platform API)

Единое машиночитаемое описание модуля или плагина (PLATFORM_AUDIT G1). Схема и вывод —
`packages/shared-types/src/component-manifest.ts`.

## Поля

| Поле | Смысл |
|---|---|
| `id` | идентификатор; уникален среди модулей и плагинов |
| `kind` | `"module"` или `"plugin"` |
| `version` | semver компонента |
| `title`, `description` | подпись и краткое описание (из `label`/`summary` каталога) |
| `requires.platform` | диапазон `PLATFORM_API_VERSION` (`^1.0.0`; поддержаны точная версия, `^`, `~`, `>=`) |
| `requires.modules` | жёсткие зависимости (у плагина модуль-хозяин добавляется всегда) |
| `requires.moduleVersions` | необязательные диапазоны версий обязательных модулей |
| `requires.optionalModules` | мягкие зависимости (`optionalDependencies` модуля) |
| `permissions` | разрешения из реестра (`permissions.ts`), вида `tasks.task.read`; у модулей заполнены, у плагинов пусто |
| `contributions` | `panels`, `slots`, `apiRoutes` |
| `events` | `publishes` / `subscribes` |
| `migrations` | имена миграций модуля (у подключённых манифестом — из `GENERATED_MODULE_MIGRATIONS`; у остальных пусто) |

## Как выводится сегодня

`buildComponentManifests()` строит манифесты из `MODULE_CATALOG` и `PLUGIN_CATALOG`
(`COMPONENT_MANIFESTS` — готовая константа). Источник истины остаётся в каталогах; манифест —
производное представление. Версия и необязательный requires подключаемого компонента сохраняются из source JSON через GENERATED_MODULE_METADATA / GENERATED_PLUGIN_METADATA. Для встроенных компонентов без source metadata остаются defaults `1.0.0` / `^1.0.0`.

- Модуль: `optionalModules` = `optionalDependencies`, `contributions.panels` = `[panelId]`.
- Плагин: `requires.modules` = `[extendsModuleId]`.
- `permissions` модуля = его разрешения из реестра; у встроенных плагинов этот список пока пуст.
- `events` выводятся из каталога доменных событий и подписок; у подключаемых модулей `migrations` берутся из `GENERATED_MODULE_MIGRATIONS`. `apiRoutes` в производном представлении не заполнены.
- `contributions.slots` у плагинов пусто: слоты известны только веб-реестру
  (`apps/web/plugins/index.ts`). Их сверка с `SlotContracts` — в `scripts/architecture-check.mjs`.

## Что проверяется

- Юнит-тесты (`component-manifest.test.ts`): каждая запись каталога имеет валидный манифест, id
  уникальны, все ссылки на модули существуют, нет циклов среди жёстких зависимостей, диапазон
  платформы удовлетворяется `PLATFORM_API_VERSION`.
- `pnpm architecture-check` (G23): плагины вносят вклад только в слоты из `SlotContracts`; каждый
  зарегистрированный в вебе плагин есть в `PLUGIN_CATALOG`; у каждого плагина каталога есть веб-вклад
  или серверное использование (`@RequirePlugin`, `pluginOffWhere`, `isPluginEnabled`).

## Зависимые и жизненный цикл (G6, G7)

- «Кто зависит от X» — `dependentsOf` / `enabledHardDependents` (`shared-types/src/component-dependencies.ts`): жёсткие
  (`requires.modules`, плагин → модуль-хозяин) и мягкие (`optionalModules`, только справочно). Модуль или плагин с
  включёнными жёсткими зависимыми сервер выключает лишь с `confirm: true` в теле `PATCH`; иначе 409
  `{ code: "component_has_dependents", dependents: [...] }`. Каскадов нет: зависимые плагины становятся неактивными
  (`pluginStates`), их данные и переключатели не меняются.
- `required` (`MODULE_CATALOG`) → 409 `component_required`, даже с `confirm`. Оболочка (дашборд, инбокс, поиск, настройки, sync)
  не компонент и выключаться не может.
- `ComponentLifecycle` (`onEnable/onDisable`) регистрируется по `componentId` через
  `CapabilityLifecycle.registerComponent`; хуки идут в транзакции переключения, исключение откатывает его (500).

## Применение в рантайме и ограничения

По [ADR-0025](../adr/ADR-0025-component-activation-compatibility.md), включение проверяет платформу, контракты, обязательные модули и их версии внутри транзакции до записи настроек/hooks. Неуспех — 409 `component_incompatible`; автоматического включения соседей нет. Проверка применяется также в module/plugin guard для уже включённых/default-on компонентов. Выключение не блокируется несовместимостью и не удаляет данные.

Source JSON может объявить `requires.platform`, `requires.modules` (id[]), `requires.moduleVersions` (диапазоны только перечисленных обязательных модулей) и `requires.contracts`. Циклы и несовместимые транзитивные зависимости блокируются. Мягкие зависимости не блокируют. `permissions` остаётся декларацией операций, а не sandbox-полномочиями компонента. Независимая установка серверного кода и автоматическая миграция при toggle не добавляются.

Шина событий работает отдельно через каталог событий и подписок ([EVENTS.md](EVENTS.md)); миграции подключаемых модулей включаются генератором в общую цепочку Prisma. Нельзя считать эти механизмы отсутствующими из-за отсутствия универсального интерпретатора манифеста.

Внешние расширения — отдельный механизм `apps/api/src/extensions`: собственный manifest, проверка диапазона `engines.orion`, подтверждение хеша кода и состояния совместимости. Его не следует смешивать с жизненным циклом встроенных Nest-модулей и плагинов. Независимая установка произвольного серверного модуля этим производным манифестом не обеспечивается.

## Версионирование

- Изменили контракт компонента (слоты, права, события, API) — поднимите его `version`.
- `PLATFORM_API_VERSION`: мажорная часть меняется только при несовместимом изменении публичных
  контрактов платформы; компоненты с `requires.platform` под старый мажор перестают подходить.
  Минорная — совместимые добавления, патч — исправления.
- Версии source metadata применяются при построении манифестов; автоматическое определение breaking changes не реализовано. Версию повышает автор контракта.

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
| `requires.modules` | жёсткие зависимости (у плагина — модуль-хозяин `extendsModuleId`) |
| `requires.optionalModules` | мягкие зависимости (`optionalDependencies` модуля) |
| `permissions` | права вида `tasks.read` |
| `contributions` | `panels`, `slots`, `apiRoutes` |
| `events` | `publishes` / `subscribes` |
| `migrations` | идентификаторы миграций компонента |

## Как выводится сегодня

`buildComponentManifests()` строит манифесты из `MODULE_CATALOG` и `PLUGIN_CATALOG`
(`COMPONENT_MANIFESTS` — готовая константа). Источник истины остаётся в каталогах; манифест —
производное представление. Все версии — `1.0.0`, `requires.platform` — `^1.0.0`.

- Модуль: `optionalModules` = `optionalDependencies`, `contributions.panels` = `[panelId]`.
- Плагин: `requires.modules` = `[extendsModuleId]`.
- `permissions`, `events`, `migrations`, `apiRoutes` пока пусты.
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

## Что пока НЕ применяется в рантайме

Рантайм манифесты не читает. Не реализованы: проверка совместимости версий при старте, учёт
`requires.modules` при ВКЛЮЧЕНИИ (при выключении зависимые учитываются, см. выше), проверка `permissions`, шина событий, учёт миграций компонента, установка и обновление
пакетов, внешние манифесты-файлы. Поля `permissions`/`events`/`migrations` — заготовка контракта.

## Версионирование

- Изменили контракт компонента (слоты, права, события, API) — поднимите его `version`.
- `PLATFORM_API_VERSION`: мажорная часть меняется только при несовместимом изменении публичных
  контрактов платформы; компоненты с `requires.platform` под старый мажор перестают подходить.
  Минорная — совместимые добавления, патч — исправления.
- Пока версии компонентов статичны (`1.0.0`) и не сверяются с изменениями автоматически.

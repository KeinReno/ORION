# Surface API (Window/Surface, G17)

## Как сейчас (v1.0, зафиксировано)

- **Хост.** `Workbench` на dockview (`packages/ui/src/workbench.tsx`), рендерится один раз в `apps/web/app/(app)/layout.tsx`.
  Панели общаются через `apps/web/lib/panel-bus.ts` (`openPanel`, `openEntity`, `openObject`, `focusTask`), не через URL.
- **Описание панели.** `PanelDefinition` (`apps/web/lib/panel-registry.ts`): `id`, `label`, `icon`, `component`, `moduleId`,
  `pluginId`, `hideFromNav`, `group`, `instanced`, `navParent`. Компонент получает `PanelComponentProps` (`params.instanceId`,
  `params.view`, `params.locked`, `api.setTitle`, `api.close`). Реестр — статический массив в ядре.
- **Панели-экземпляры:** `<panel>:<instanceId>` (`project:<id>`, `list:<id>`, `task`, `note`, `browsertab`).
- **Открепление в окно ОС:** `apps/web/lib/panel-window.ts` (`detachPanelToWindow`, `openWorkspaceInNewWindow`),
  `DetachHeaderAction` в `app/(app)/layout.tsx`; окно открепления `/panel/<id>?instance=<id>`; в браузере popout родной (dockview).
- **Раскладки:** именованные (`apps/web/lib/named-layouts.ts`, `LAYOUT_LIMIT = 12`), санитайзер `dock-layout-sanitize.ts`,
  ключ `dock-layout-key.ts`; синхронизация окон — `cross-window-sync.ts`.
- **Вклад в чужие поверхности — слоты** (`apps/web/lib/extensions/contracts.ts`, `SlotContracts`, 38 слотов), например
  `shell.sidebar.widgets` (виджет), `shell.context.resources` (панель контекста). Изоляция сбоев вкладов уже есть:
  `apps/web/lib/extensions/slot-boundary.ts` (`ErrorBoundary` на каждый вклад, лог с `pluginId` и слотом).

## Контракт v1.0 как есть

Поверхности PLATFORM.md §3 (основная область, вкладка, боковая панель, виджет, плавающее окно, окно ОС) выражены разнородно:
вкладка и открепление — `PanelDefinition` + dockview; виджет — отдельные слоты; плавающие окна — возможность dockview без
контракта. Единого перечня «поддерживаемые поверхности» у компонента нет.

## Целевое состояние

Манифест объявляет поддерживаемые поверхности (поле `contributions.panels` уже есть, расширяется до записи с перечнем
поверхностей); `PanelDefinition` выводится из манифеста; образец открывается в трёх поверхностях.

## Поверхности в манифесте (G17, частично)

Закрытый набор `SURFACE_IDS` (`packages/shared-types/src/component-manifest.ts`): `dock` (основная область и вкладка дока — в ORION
одно и то же), `side` (боковая панель/контекст), `widget` (карточка дашборда, виджет сайдбара), `floating` (плавающее окно дока),
`window` (окно ОС). Поле `surfaces` манифеста по умолчанию выведено из фактов: модуль — `dock, floating, window` (+ `widget`,
если у модуля карточка на дашборде); плагин — пусто, кроме панельных плагинов и вкладов в слоты (`calendar-widget` → `widget`,
`documents-resources` → `side`). `PanelDefinition.surfaces` выводится из манифеста владельца (плагин, иначе модуль; панель без
владельца — оболочка), панель-экземпляр не бывает `widget` (`apps/web/lib/panel-surfaces.ts`). Кнопка «открепить», «Открыть в новом
окне», режим «в окне» и `/panel/<id>` требуют `window`; кнопка «плавающее окно» — `floating`.

## Не сделано

Слоты виджета/боковой панели не читают `surfaces`; реестр панелей по-прежнему статичен (панели пишутся в `panel-registry.ts`, из манифеста выводятся лишь поверхности); проверка открепления в Tauri и на нескольких мониторах
(`docs/STATUS.md`); в Tauri нет перетаскивания панели за край в отдельное окно (CLAUDE.md, осознанное ограничение).

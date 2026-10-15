# Первый срез: совместимые токены KAIDEN v1

Работа начата 15 октября, проверки продолжены 16 октября 2026 года.
База: `origin/master` на `280162d`. Ветка: `redesign/kaiden-foundation-20261015`.
Это ограниченный фундамент фазы 1, а не завершение Theme Engine или нового Shell.

## Изученный контекст и зависимости

Прочитаны пакет `00`–`05` и README редизайна, приложенный текст из исходного чата,
`AGENTS.md`, конституция, документы модулей/плагинов, AI-first архитектуры,
карта миграции, frontend workspace spec и предыдущий UI audit.
Авторитетные документы задают три уровня: глобальный rail → контекст пространства →
контекст объекта. Они остаются целью фазы 3; этот PR не меняет маршруты и права.

Установлены зависимости по существующему lockfile (`pnpm install --frozen-lockfile`).
Новых зависимостей и изменений lockfile нет. Использован существующий стек:
Next 14 / React 18 / Tailwind 3, общий `@orion/ui`, Dockview, Tauri WebviewWindow.
Работа изолирована от незакоммиченных изменений Opportunity Hub в Desktop/ORION.

## Инвентаризация и матрица миграции

| Поверхность / владелец | Фактические файлы | Решение и зависимость |
| --- | --- | --- |
| Core shell | `apps/web/app/(app)/layout.tsx`, `lib/panel-registry.ts`, `lib/panel-bus.ts` | Сохранить; постепенно нарастить ObjectRef/ViewRef, не менять доменные API |
| Rail / пространства | `packages/ui/src/sidebar.tsx`, `apps/web/components/workspace-switcher.tsx`, `lib/workspace-order.ts`, `lib/sidebar-folders.ts` | Сохранить значки, группы и предпочтения; новая навигация отдельным срезом |
| Dock / окна | `packages/ui/src/workbench.tsx`, `apps/web/lib/panel-window.ts`, `lib/named-layouts.ts`, `lib/dock-layout-key.ts` | Сохранить Dockview и WebviewWindow; не вводить второй оконный движок |
| Inspector / черновики | `apps/web/panels/tasks/task-detail.tsx`, `lib/unsaved-drafts.ts`, типизированные editor slots | Сохранить autosave/guards; общий inspector потребует отдельного контракта |
| Настройки вида | `apps/web/lib/preferences-effect.tsx`, `panels/SettingsPanel.tsx`, `packages/shared-types/src/settings.ts` | Сохранить accent/density/background/glass, не мигрировать stored `theme` |
| Общий UI | `packages/ui/src/primitives.tsx`, `panel-shell.tsx` | Только Button и PanelHeader перевести на совместимые aliases |
| Plugins / slots | `apps/web/lib/extensions/{contracts,registry,slot,host-api}`, `apps/web/plugins` | Сохранить composition и defaults; публичный visual API через `@orion/ui` |
| Жёсткая палитра | `apps/web/tailwind.config.js`, `app/globals.css`, отдельные plugin styles | Массовую замену отложить; старые utility names пока сохранены |

Ничего не удалено. Бизнес-логика, БД, API, ACL, модули, логотип и schema настроек
не менялись. Сохранённые layout и пользовательские темы/предпочтения не записываются этим кодом.

## Реализованный контракт

- `packages/ui/src/design-tokens.ts`: `DESIGN_SYSTEM_VERSION = 1`, семантика
  canvas/surface/elevated/hover, primary/secondary text, borders, accent, focus,
  selected и независимые success/warning/danger/info; component aliases для Button и PanelHeader.
- `theme.css`: CSS bridge с **точными текущими значениями**. Акцент и статусные цвета
  продолжают ссылаться на `--orion-*`, поэтому штатные настройки остаются источником истины.
- `theme-provider.tsx`: публичные `ThemeProvider` / `useTheme`, scope CSS variables на
  собственном контейнере. `document.documentElement`, localStorage и backend не меняются.
- Кандидат KAIDEN Precision включается только с точным флагом `kaiden-theme-v1`.
  Неизвестный флаг/тема и отсутствие флага дают legacy. Вложенная legacy-область
  явно восстанавливает старые значения. Изменение или снятие флага обратимо.
- В штатном приложении **нет принудительного включения Precision** и пока нет нового
  переключателя темы в настройках. Это opt-in API для следующего среза и previews.

```tsx
import { ThemeProvider, Button, PanelHeader } from "@orion/ui";

<ThemeProvider flag="kaiden-theme-v1" theme="kaiden-precision" className="h-full">
  <PanelHeader title="Образец" actions={<Button>Продолжить</Button>} />
</ThemeProvider>
```

Старые spacing/type/radius/motion и все варианты кнопок остаются прежними.
Primitive scales, tab/item/inspector aliases и миграция остальных компонентов ещё впереди.
ThemeProvider не является валидатором пользовательского JSON и не принимает исполняемые темы.

## Проверки и свидетельства

Исходная ревизия: typecheck, build, architecture-check, plugin-contract-check прошли;
756 unit-тестов прошли. Полный lint уже исходно падает на `apps/web/lib/note-export.ts:6`
(`no-control-regex`); также есть два предупреждения hooks в CalendarPanel / DocumentsPanel.
Эти файлы не исправлялись в рамках темы.

Проверки среза:

| Проверка | Результат |
| --- | --- |
| `pnpm typecheck` | Пройдено |
| `pnpm test` | 762 теста, 98 файлов, пройдено |
| `pnpm architecture-check` | Пройдено |
| `pnpm plugin-contract-check` | 10 тестов, пройдено |
| ESLint изменённых TS/TSX файлов | Пройдено |
| `pnpm lint` | Та же исходная ошибка и два предупреждения, gate остаётся открытым |
| `pnpm build` | API и web пройдены |
| `pnpm build:desktop-export` | Пройдено; это статический export, не native/installer acceptance |
| DB integration: api-rls, plugin-gates, user-hidden-modules | 30 тестов, пройдено на отдельной БД |
| Runtime capture до/после | По 16 кадров: 7 панелей + shell, ширины 1280/390; page errors=0, failed HTTP=0 |
| Старый E2E action inventory | 8/12 проходят; 4 сравнения календаря/настроек расходятся с устаревшими эталонами |
| Новый `e2e/theme-foundation.spec.ts` | Пройдено: 5 сохранённых акцентов, hover/foreground, compact/glass, focus, modal open/Escape |

Снимки сделаны в настоящих маршрутах `/panel/*` и `/dashboard` на синтетическом
solo-dev workspace, отдельные web/API/PG порты 3110/4100/5547. Личные аккаунты и
рабочая БД не использовались. Desktop/ORION и запущенное пользователем приложение
не останавливались и не переключались на новую ветку.

На Tasks, Projects, Calendar, Settings, Opportunities кадры до/после на обеих ширинах
совпали **попиксельно** (10 пар). Notes/Dashboard содержат относительное время и
динамические значения; их пиксельный diff нельзя считать строгим golden test.
Первый широкий shell-кадр был снят раньше готовности Dockview content и не является
валидным golden baseline оболочки. Полное screenshot parity shell не заявляется.
Замер navigation-to-network-idle сохранён как диагностический: dev cold compile,
а не production time-to-interactive. Достоверный TTI benchmark ещё не сделан.

В старых E2E snapshots отсутствуют уже существующие действия «Дни рождения» и
«Вынести вкладку “Профиль”». Они присутствуют в runtime baseline ещё до переноса токенов.
Golden files не обновлялись ради зелёного результата.
Отдельный повтор этих четырёх тестов с исходными visual-файлами `280162d`
воспроизвёл те же четыре snapshot failure; затем изменённые файлы восстановлены.

Свидетельства: [`evidence/foundation-v1/`](evidence/foundation-v1/).
Визуальные previews — реальные Button/PanelHeader, отрендеренные с публичным ThemeProvider,
а не макет всего будущего Orion. Это не доказывает готовность палитры для всех модулей.

## Матрица доступа / окон и незакрытые gates

| Сценарий | Подтверждение / предел |
| --- | --- |
| Чужое workspace и API | 30 integration tests покрывают RLS/plugin/user isolation; новых запросов нет |
| Modules/plugins OFF | Legacy panels action smoke выполнен с plugins-off; данные не удаляются |
| Две области темы | SSR проверяет вложенный/sibling context; browser preview — разные вычисленные цвета |
| Workspace switch / drafts | Код не меняется; ручной сценарий редактирования и возврата ещё нужен |
| Tauri / два монитора / cross-window | Не проверено; export не подменяет такую проверку |
| Preview / portals | Scope по DOM-поддереву. Portal вне контейнера не наследует тему; потребуется явный ThemeProvider в portal host |

Gate 0 **частично закрыт для этого совместимого среза**, не объявлен закрытым для
полной перестройки оболочки: отсутствуют native screenshots, multi-monitor acceptance,
полная матрица черновиков/смены пространств и production TTI. Ветка предназначена для
review; массовая визуальная миграция и включение темы на весь продукт заблокированы этими gates.

## Откат и следующие этапы

Откат: убрать opt-in flag в пробном host; весь срез можно откатить Git revert без
миграций БД или настроек. Не требуется backup/restore пользовательских preferences,
поскольку код их не записывает.

1. Закрыть lint и устаревшие E2E baselines отдельным maintenance-срезом; закончить Gate 0.
2. Завершить фазу 1: primitive scales и оставшиеся aliases, больше безопасных компонентов,
   visual parity и disabled-plugin smoke для каждого переноса.
3. Фаза 2: сохранённый выбор темы, light/dark/custom, валидированный JSON, preview/cancel,
   приоритет global → workspace → ephemeral, отдельная density и штатная cross-window доставка.
4. Фаза 3: три уровня навигации, ObjectRef/ViewRef, inspector и восстановление Dockview layout.
5. Фазы 4–6: оконная модель, по одному модулю за PR, затем mixed-space/Atlas/agents при готовых ACL/ADR.

Использован skill `ui-design`, режим Build: SKILL.md, design-guidelines.md,
direction/aesthetic-direction.md, guidelines/colors.md, dark-mode.md, buttons.md,
surfaces.md. Существующая палитра сохранена согласно требованиям проекта.


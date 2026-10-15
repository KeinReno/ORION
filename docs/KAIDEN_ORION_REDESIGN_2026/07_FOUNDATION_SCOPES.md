# Второй срез фундамента: шкалы и темы портальных компонентов

Дата: 2026-10-16. Продолжение ветки `redesign/kaiden-foundation-20261015` и PR №1.
Основа: `389b34c`. Это продолжение фазы 1, не включение Theme Engine для пользователей.

## Что изменилось

1. Отдельный maintenance-коммит `6da3c12` устраняет известный блокер полного lint:
   сохранено удаление управляющих символов из имени экспортируемой заметки,
   добавлено локальное обоснование исключения `no-control-regex`.
   Исполняемый код и содержимое экспорта не изменились.
2. В четырёх E2E action snapshots добавлены только ранее подтверждённые действия
   календаря/профиля. Обновление получено настоящим запуском тестов до нового UI-среза.
3. `PRIMITIVE_TOKENS`: существующие rem-отступы, радиусы и ссылки на текущую
   типографику. Compact продолжает управляться штатным root font-size и `--font-*`.
4. `COMPONENT_TOKEN_ALIASES`: button/tab radius, panel spacing, overlay/inspector
   surface и border, item hover. Это добавление к схеме v1, без миграции данных.
5. Button использует alias радиуса, PanelBody — aliases padding/gap. Значения
   полностью совпадают с прежними Tailwind `rounded-lg`, `p-6`, `space-y-6`.
6. Modal, Sheet и Popover получают токены области, из которой их открыл React.
   Их поверхности/границы/заголовки используют семантические aliases, с точными
   legacy значениями и прежними коэффициентами прозрачности 0.85/0.90.

## Почему понадобилась передача темы в portal

React context проходит через `createPortal`, а CSS наследуется по DOM.
Раньше диалог, открытый внутри ThemeProvider, оказывался под `document.body`
и терял variables своего контейнера. Теперь `useThemeScopeProps()` переносит
эффективные variables и data-атрибуты на уже существующий корень overlay.
Новый layout-wrapper не добавляется. Координаты Popover, фокус, Escape,
autosave и stack логика диалогов остаются прежними.

Без явного ThemeProvider hook возвращает пустые props: обычные диалоги
продолжают наследовать текущую legacy-тему приложения. Две независимые области
не перекрашивают друг друга. Снятие preview flag обновляет уже открытый диалог,
не перемонтируя содержимое и не стирая его черновик.

Публичный контракт для собственного portal плагина:

```tsx
import { useThemeScopeProps } from "@orion/ui";

const scope = useThemeScopeProps();
return createPortal(
  <div {...scope} style={{ ...scope.style, position: "fixed", top, left }}>
    {children}
  </div>,
  document.body
);
```

Если у portal уже есть `style`, его нужно объединить со `scope.style`.
Публичные props не предоставляют прав на данные и не записывают глобальную тему.
Toast/Tooltip и собственные сторонние portals ещё не мигрированы. Вложенные
поля с legacy utility classes пока сохраняют свои цвета; этот срез не объявляет
все диалоги полностью готовыми ко всем будущим light/custom темам.

## Проверки

Новая проверка `apps/web/lib/theme-portals.test.ts` использует реальные React
Modal/Sheet/Popover, смонтированные в jsdom, включая настоящие `createPortal`:

- Modal и Sheet находятся вне DOM-контейнера владельца, но получают его токены.
- Снятие флага сохраняет тот же input DOM-node и введённый несохранённый текст.
- Одновременные sibling dialogs имеют независимые темы.
- Popover сохраняет fixed positioning и tokens.
- Unscoped legacy dialog не получает навязанных scoped props.

Изолированные web/API/Postgres: 3110/4100/5547. Повторно снято по 16 кадров
до/после на 1280/390. В обоих проходах page errors=0, failed HTTP=0,
документного горизонтального overflow у проверенных панелей не обнаружено.
Десять пар совпали целиком; оставшиеся различия локальны и включают относительное
время, текущий индикатор календаря и динамический shell. Pixel diff сохранён
как диагностическое свидетельство, не как объявление полного visual acceptance.

Окончательные результаты команд и дополнительные baseline-наблюдения приведены ниже.

| Проверка | Результат |
| --- | --- |
| Typecheck | Пройдено |
| Unit | 768 тестов / 99 файлов, пройдено; из них 6 новых portal cases |
| Полный lint | Пройдено, остались 2 прежних предупреждения hooks |
| Architecture / plugin contracts | Пройдено; 10 registry tests |
| Production API/web build | Пройдено |
| Desktop static export | Пройдено; native Tauri не подменяется этим результатом |
| Финальный browser smoke | **43/43 пройдено**: 21 панель × default-full/plugins-off + regression предпочтений |
| Реальный browser portal preview | Precision surface, cancel с сохранением ввода, неизменный global accent, Escape, 390 px — пройдено |

Расширенный action smoke всех панелей обнаружил ещё 9 старых snapshot mismatch
в Dashboard, Inbox, Goals, Home, Finance. Они воспроизведены на исходных UI-файлах
`6da3c12`; полученные inventories затем **побайтово сопоставлены** с inventories
нового UI. Только после совпадения обновлены ровно 9 эталонов в отдельном
коммите `552629c`. [Результат сопоставления](evidence/foundation-scopes/action-baseline-comparison.json).
Это актуализация снимков текущего кода, а не изменение функций этих модулей.

Перед повтором baseline страницы прогреты после переключения исходников:
первый dev/HMR переход не использовался как доказательство стабильного поведения.
Изменённые файлы восстановлены из сохранённых копий; новый UI и maintenance
остаются раздельно обозримыми в коммитах.

[Runtime observations и pixel diff](evidence/foundation-scopes/) дополняют
результаты тестов. DB integration не повторялись в этом UI-срезе: серверные
контракты и схема БД не изменялись; 30 проверок предыдущего среза описаны в документе 06.

Временный browser preview использовал настоящие ThemeProvider/Modal/Button/Input,
а не имитацию CSS. Его тестовый маршрут удалён перед коммитом; в продукт не добавлен
демонстрационный экран. Снимки: [Precision dialog](evidence/foundation-scopes/scoped-dialog-precision.png),
[после отмены темы](evidence/foundation-scopes/scoped-dialog-cancelled.png),
[узкий диалог](evidence/foundation-scopes/scoped-dialog-mobile.png).
Поля Input ещё сохраняют legacy focus color, как видно на снимке; их миграция
и остальные компоненты остаются отдельным вертикальным срезом.

## Границы и откат

Не менялись БД, preferences schema, права, маршруты объектов, composition плагинов,
Dockview, реестр модулей, логотип и API. Новая тема всё ещё включается только явным
`kaiden-theme-v1`; выбор темы в настройках будет отдельным срезом фазы 2.

Откат UI-среза — Git revert, без восстановления БД или preferences.
Maintenance-коммит откатывается независимо. Работа выполнялась в изолированной
копии; пользовательский Desktop/ORION и его запущенный экземпляр не изменялись.

Остаются gates: полный native Tauri/multi-monitor проход, смена workspace с
черновиком, production TTI и полная визуальная приёмка. До их закрытия не включать
Precision на весь продукт и не начинать массовую миграцию или замену оболочки.


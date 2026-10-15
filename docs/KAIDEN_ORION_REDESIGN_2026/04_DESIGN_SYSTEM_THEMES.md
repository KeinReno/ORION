# 04. KAIDEN Design System + Theme Engine

## Главный инвариант
Все визуальные компоненты и плагины наследуют семантические **design tokens**, не хардкодят палитру. Темы не изменяют права, данные и фирменный логотип. Старая тема/оформление сохраняются до parity.

## Слои токенов
1. **Primitive**: цветовые шкалы, spacing scale, radius, type scale, shadows.
2. **Semantic**: `bg.canvas`, `bg.surface`, `bg.elevated`, `text.primary`, `text.secondary`, `border.default`, `accent.base`, `accent.hover`, `focus.ring`, `status.success/warning/danger/info`, `interactive.selected`.
3. **Component aliases**: `sidebar.bg`, `tab.active`, `inspector.border`, `calendar.event`, `graph.edge`, если семантического уровня недостаточно.
4. **Context**: пользовательские предпочтения, override отдельного пространства, плотность/радиусы/эффекты, временный preview.

Пример (проектная схема, не фактический формат конфигурации):
```json
{
  "schemaVersion": 1,
  "id": "user-theme-example",
  "name": "My Midnight",
  "baseMode": "dark",
  "colors": {
    "canvas": "#10151E",
    "surface": "#171F29",
    "textPrimary": "#F2F5F9",
    "accent": "#6BAAFF",
    "border": "#35404C",
    "success": "#52BD8E",
    "warning": "#E2AC53",
    "danger": "#EC6871"
  }
}
```
Валидация схемы, дефолтные значения и versioned migrations обязательны; никакого исполняемого CSS/JS из импортированной темы без sandbox.

## Стартовые темы
KAIDEN Precision (тёмная графит/золото, фирменная по умолчанию); Obsidian (нейтральная тёмная); Arctic (светлая); Midnight (тёмно-синяя); Emerald (графит/зелёный); Crimson (тёмная/бордовая). Названия рабочие, точные палитры подлежат утверждению после тестов.

## Приоритет оформления
`system/application default → user global theme → workspace override → ephemeral preview`.
Применение темы индивидуальной панели в mixed-space view требует **scope CSS variables** на root панели; системный chrome остаётся в глобальной теме. Не переписывать `document.documentElement` при активации чужой панели: это окрашивало бы весь UI непредсказуемо.

## Theme Builder v1
Выбор предустановленной темы, создание дубликата, редактирование цветов, live preview, отмена, импорт/экспорт JSON, сброс по умолчанию. Плотность (compact/comfortable), радиусы и эффекты — **отдельные предпочтения**, не комбинаторное число тем. Темы должны переживать перезапуск и при наличии штатного пользовательского backend — синхронизироваться через предусмотренный контракт, не вручную между клиентами.

## UX и доступность
Контраст текста >= 4.5:1 для обычного текста и >= 3:1 для крупного/значимых UI-границ, где применимо. Не кодировать статус только цветом. `prefers-reduced-motion`, focus-visible и состояние hover/disabled в каждой теме. Брендовая иконка не меняется. Preview не должен перезаписывать сохранённые настройки до подтверждения.

## API для модулей/плагинов
Публичное чтение эффективных токенов/предпочтений, регистрация декларативных визуальных потребностей через typed slots. Плагин не меняет CSS переменные глобального приложения и не требует импортировать внутренний theme manager. Если контракт отсутствует — Extension Proposal.

## Приёмка
На каждой готовой теме проверить: навигацию, список задач, инлайн-редактирование, заметки, календарь, граф/канвас при наличии, плагины, модальные окна, тосты, inspector, окно Tauri. Проверить mixed-space views, keyboard focus, текстовые контрасты, reset, import invalid JSON, миграцию schemaVersion, закрытие preview без сохранения.

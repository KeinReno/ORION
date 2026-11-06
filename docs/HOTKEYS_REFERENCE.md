# ORION — Горячие клавиши (UI-06)

**Статус:** ✅ Реализовано в revision `821e694` + доработка `work/qoder1/UI-06-sequences`  
**Базовая ревизия:** 821e694370f44485442edcdfe83de23709b1a8d8 (Windows beta 37)

## Обзор системы

ORION имеет централизованную систему управления горячими клавишами с поддержкой:
- **Scope-based scoping**: хоткеи активны только в определённых контекстах (`global`, `notes-editor`, `workbench`)
- **Редактирование**: пользователи могут переназначать сочетания через Settings Panel → "Горячие клавиши"
- **Конфликт-чекер**: предупреждает о коллизиях при сохранении
- **Двухэтапные последовательности**: G-sequence (нажать G, затем буква) для навигации по панелям
- **Нормализация**: одинаковые комбинации сравниваются независимо от порядка модификаторов

## Архитектура

### Файлы

| Файл | Назначение |
|------|-----------|
| `apps/web/lib/shortcuts/catalog.ts` | Центральный реестр всех хоткеев (SHORTCUT_CATALOG) |
| `apps/web/lib/shortcuts/registry.tsx` | Dispatcher и hooks (`useShortcutHandler`, `GlobalShortcutDispatcher`) |
| `apps/web/lib/shortcuts/combo.ts` | Парсинг/нормализация/описание комбо (без DOM) |
| `apps/web/panels/settings/shortcuts-section.tsx` | UI настройки хоткеев |

### Типы scopes

```typescript
type ShortcutScope = "global" | "notes-editor" | "workbench";
```

- **global**: активно всегда, перехватывает все клавиши (command palette, quick capture)
- **notes-editor**: только внутри редактора заметок (через CodeMirror keymap)
- **workbench**: активно на рабочем столе (named layouts, history navigation)

### Интерфейсы

```typescript
interface ShortcutDef {
  id: string;
  scope: ShortcutScope;
  category: string;      // Для группировки в UI
  label: string;
  defaultCombo: string;  // Например: "mod+k", "g+d", "alt+1"
  allowInInput?: boolean; // Разрешить ввод в полях
}
```

## Полный список хоткеев (каталог)

### Везде (global)

| ID | Команда | Combo | Allow in Input |
|----|---------|-------|----------------|
| global.command-palette | Поиск и команды | mod+k ✓ | true |
| global.quick-capture | Быстрый захват | mod+shift+n ✓ | true |

### Переходы по панелям (G-sequence: нажать G, затем буква)

Эти хоткеи работают как двухэтапная последовательность — система ждёт ~800ms после нажатия первой клавиши.

| ID | Панель | Combo | Label |
|----|--------|-------|-------|
| global.goto-dashboard | Dashboard | g+d | Дашборд |
| global.goto-inbox | Inbox | g+i | Инбокс |
| global.goto-tasks | Tasks | g+t | Задачи |
| global.goto-calendar | Calendar | g+c | Календарь |
| global.goto-notes | Notes | g+n | Заметки |
| global.goto-projects | Projects | g+p | Проекты |
| global.goto-time | Time | g+w | Время |
| global.goto-habits | Habits | g+h | Привычки |
| global.goto-lists | Lists | g+l | Списки |
| global.goto-finance | Finance | g+f | Финансы |
| global.goto-inventory | Inventory | g+k | Склад |
| global.goto-markets | Markets | g+m | Рынки |
| global.goto-browser | Browser | g+b | Браузер |
| global.goto-documents | Documents | g+o | Документы |
| global.goto-sync | Sync | g+y | Резервные копии |
| global.goto-settings | Settings | g+s | Настройки |

### Заметки — форматирование (notes-editor)

Работают только внутри MarkdownEditor через CodeMirror keymap.

| ID | Команда | Combo | Label |
|----|---------|-------|-------|
| notes.bold | bold | mod+b ✓ | Жирный |
| notes.italic | italic | mod+i ✓ | Курсив |
| notes.strike | strike | mod+shift+x ✓ | Зачёркнутый |
| notes.code | code | mod+e ✓ | Код в строке |
| notes.link | link | mod+shift+k ✓ | Ссылка |

### Заметки — блоки (notes-editor)

| ID | Команда | Combo | Label |
|----|---------|-------|-------|
| notes.h1 | heading1 | mod+alt+1 ✓ | Заголовок 1 |
| notes.h2 | heading2 | mod+alt+2 ✓ | Заголовок 2 |
| notes.h3 | heading3 | mod+alt+3 ✓ | Заголовок 3 |
| notes.ordered | orderedList | mod+shift+7 ✓ | Нумерованный список |
| notes.bullet | bulletList | mod+shift+8 ✓ | Маркированный список |
| notes.task | taskList | mod+shift+9 ✓ | Список задач |
| notes.quote | quote | mod+shift+. ✓ | Цитата |
| notes.codeblock | codeBlock | mod+alt+c ✓ | Блок кода |
| notes.convert-to-task | convertSelectionToTask | mod+alt+t ✓ | Выделенное — в задачу |

### Workbench (workbench)

| ID | Команда | Combo | Description |
|----|---------|-------|-------------|
| global.layout-1…9 | Named layouts | alt+1…9 | Применение сохранённых раскладок Dockview |
| global.history-back | History back | alt+arrowleft | История переходов назад |
| global.history-forward | History forward | alt+arrowright | История переходов вперёд |

## Работа последовательностей (G-sequence)

### Логика

```
1. Пользователь нажимает "g" → активируется режим ожидания второй клавиши
2. Система ждёт ~800ms для ввода второго символа
3. Если вторая клавиша нажата — выполняется команда (например, openPanel("tasks"))
4. Если таймаут истёк — состояние сбрасывается без действия
```

### Реализация

Общий префикс `g` держит `advanceSequence` в `apps/web/lib/shortcuts/combo.ts`: вторая буква выбирает конкретную панель (`g` затем `d` — дашборд, `g` затем `i` — инбокс). Пока префикс активен, оболочка показывает подсказку. Раскладки `Alt+1`…`Alt+9` — обычные сочетания, не последовательности.

### Конфликты

⚠️ **Важно**: G-sequences конфликтуют с обычным написанием текста!

Пример: если фокус не в поле ввода, `g` затем `d` открывает дашборд, а не печатает «d». В поле ввода последовательность не перехватывается.

**Решение**: последовательности не срабатывают если текущий target — текстовое поле (`isTypingTarget`).

## Настройка через UI

### Путь

Settings Panel → вкладка "Горячие клавиши"

### Возможности

1. **Поиск**: фильтрация по label/category
2. **Редактирование**: кликнуть на кнопку с combo, нажать новое сочетание
3. **Сброс**: кнопка RotateCcw возвращает к дефолтному значению
4. **Валидация**:
   - Esc отменяет запись без изменений
   - Конфликты показываются красным текстом под строкой
   - Пустое значение ("") = временно отключить хоткей

### Пример сохранения

```json
{
  "shortcutOverrides": {
    "global.command-palette": "mod+comma",
    "notes.bold": "",        // Отключено
    "global.goto-inbox": "g+x"  // Переопределение
  }
}
```

## Проверка конфликтов

Система автоматически проверяет конфликты при сохранении настроек:

```typescript
catalogConflicts(overrides): ShortcutConflict[] {
  // Compares effective combos (override ?? default)
  // Only flags conflicts within the same scope or with global
  // Does NOT block saving — user sees warning inline
}
```

### Пример конфликта

```
notes.link: mod+shift+k
global.command-palette: mod+k

✅ Нет конфликта — разные scope и combos
```

```
global.goto-inbox: g+i
global.goto-inbox (duplicate): g+i

⚠️ Конфликт — два разных ID с одинаковым combo
```

## Интеграция компонентов

### CommandCenter

Использует `useShortcutHandler` для глобальных команд:

```tsx
useShortcutHandler("global.command-palette", () => setPaletteOpen(v => !v));
useShortcutHandler("global.quick-capture", () => setCaptureOpen(true));

// G-sequence handlers — диспетчер сам их распознаёт через catalog
Object.entries(gotoHandlers).forEach(([id, handler]) => {
  useShortcutHandler(id as any, handler);
});
```

### AppLayout (layout.tsx)

Интегрирует workbench хоткеи:

```tsx
useShortcutHandler("global.layout-1", () => applyLayout(layoutNames[0]));
useShortcutHandler("global.history-back", () => goHistory(-1));
```

### NoteEditor

Использует local CodeMirror keymap, не проходит через GlobalShortcutDispatcher:

```tsx
const formatCombosByCommand = useMemo(() => ({
  bold: formatCombos["notes.bold"],
  // ... остальные
}), [formatCombos]);

<MarkdownEditor formatCombos={formatCombosByCommand} />
```

## Тестирование

### Доступные команды

```bash
# Проверка типов
corepack pnpm typecheck

# Линт
corepack pnpm lint

# Unit тесты (не требуют PostgreSQL/browser)
corepack pnpm test:unit
```

### Сценарии проверки

1. **Basic functionality**: 
   - mod+k открывает command palette ✓
   - mod+shift+n открывает quick capture ✓

2. **G-sequence**:
   - Нажать G, ждать, нажать D → открыть Dashboard ✓
   - Нажать G, ждать 1s → таймаут, ничего не происходит ✓
   - Нажать G в текстовом поле → игнорируется ✓

3. **Workbench**:
   - Alt+1…9 применяются named layouts ✓
   - Alt+←/→ перемещаются по истории ✓

4. **Notes formatting**:
   - Внутри markdown editor: mod+b делает текст жирным ✓
   - Вне editor: mod+b игнорируется ✓

## Расширение каталога

Для добавления нового хоткея:

1. Добавить entry в `SHORTCUT_CATALOG`:
```typescript
{ 
  id: "global.my-command",
  scope: "global",
  category: "Мои команды",
  label: "Моя крутая функция",
  defaultCombo: "mod+m" 
},
```

2. Подключить handler через `useShortcutHandler`:
```typescript
useShortcutHandler("global.my-command", () => myFunction());
```

3. Проверить конфликты:
```typescript
const conflicts = catalogConflicts(overrides);
// conflicts покажет проблемы при рендеринге
```

## Ограничения

- ❌ Не работает в text inputs / textarea (кроме allowInInput: true)
- ❌ G-sequences конфликтуют с набором слов (требуется осторожность)
- ⚠️ Модификаторы: mod = Ctrl на Windows/Linux, ⌘ на macOS

## Следующие улучшения (TODO)

1. **Context awareness**: скрывать хоткеи для недоступных модулей
2. **Per-workspace profiles**: разные профили хоткеев для workspace
3. **Macro recording**: записать последовательность клавиш как одно действие
4. **Export/Import**: перенос профиля между устройствами
5. **Undo shortcut**: мод для undo последнего action (mod+z)

---

**Автор**: Qwen 3.8 Flash / Qoder Agent  
**Дата**: 2026-11-06  
**Revision**: 821e694 + work/qoder1/UI-06-sequences

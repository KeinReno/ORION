import { normalizeCombo } from "./combo";

/**
 * ORION-06 — a scope names a region of the app a shortcut only fires inside, so the same combo can
 * mean two different things in two places without stepping on each other (AC3: "hotkeys не
 * перехватывают ввод в неподходящих областях"). `"global"` is always active; every other scope is
 * active only while something calls `useShortcutScope(scope)` — typically "while this panel/editor
 * is mounted", see `registry.tsx`.
 */
export type ShortcutScope = "global" | "notes-editor";

export interface ShortcutDef {
  id: string;
  scope: ShortcutScope;
  /** Groups entries in the settings list ("Заметки — форматирование", "Везде", …). */
  category: string;
  label: string;
  defaultCombo: string;
  /** Fires even while a text field has focus — formatting commands need this; most others don't. */
  allowInInput?: boolean;
}

/**
 * The single source of truth for every rebindable shortcut: tooltips, the CodeMirror keymap, and
 * the settings list all read this instead of keeping their own copy of the combo. Adding a shortcut
 * = one entry here + a `useShortcutHandler(id, handler)` call where it's actually implemented.
 */
export const SHORTCUT_CATALOG: readonly ShortcutDef[] = [
  { id: "global.command-palette", scope: "global", category: "Везде", label: "Поиск и команды", defaultCombo: "mod+k", allowInInput: true },
  { id: "global.quick-capture", scope: "global", category: "Везде", label: "Быстрый захват", defaultCombo: "mod+shift+n", allowInInput: true },

  { id: "notes.bold", scope: "notes-editor", category: "Заметки — форматирование", label: "Жирный", defaultCombo: "mod+b", allowInInput: true },
  { id: "notes.italic", scope: "notes-editor", category: "Заметки — форматирование", label: "Курсив", defaultCombo: "mod+i", allowInInput: true },
  { id: "notes.strike", scope: "notes-editor", category: "Заметки — форматирование", label: "Зачёркнутый", defaultCombo: "mod+shift+x", allowInInput: true },
  { id: "notes.code", scope: "notes-editor", category: "Заметки — форматирование", label: "Код в строке", defaultCombo: "mod+e", allowInInput: true },
  { id: "notes.link", scope: "notes-editor", category: "Заметки — форматирование", label: "Ссылка", defaultCombo: "mod+shift+k", allowInInput: true },
  { id: "notes.h1", scope: "notes-editor", category: "Заметки — блоки", label: "Заголовок 1", defaultCombo: "mod+alt+1", allowInInput: true },
  { id: "notes.h2", scope: "notes-editor", category: "Заметки — блоки", label: "Заголовок 2", defaultCombo: "mod+alt+2", allowInInput: true },
  { id: "notes.h3", scope: "notes-editor", category: "Заметки — блоки", label: "Заголовок 3", defaultCombo: "mod+alt+3", allowInInput: true },
  { id: "notes.ordered", scope: "notes-editor", category: "Заметки — блоки", label: "Нумерованный список", defaultCombo: "mod+shift+7", allowInInput: true },
  { id: "notes.bullet", scope: "notes-editor", category: "Заметки — блоки", label: "Маркированный список", defaultCombo: "mod+shift+8", allowInInput: true },
  { id: "notes.task", scope: "notes-editor", category: "Заметки — блоки", label: "Список задач", defaultCombo: "mod+shift+9", allowInInput: true },
  { id: "notes.quote", scope: "notes-editor", category: "Заметки — блоки", label: "Цитата", defaultCombo: "mod+shift+.", allowInInput: true },
  { id: "notes.codeblock", scope: "notes-editor", category: "Заметки — блоки", label: "Блок кода", defaultCombo: "mod+alt+c", allowInInput: true },
  { id: "notes.convert-to-task", scope: "notes-editor", category: "Заметки — блоки", label: "Выделенное — в задачу", defaultCombo: "mod+alt+t", allowInInput: true }
] as const;

export function getShortcutDef(id: string): ShortcutDef | undefined {
  return SHORTCUT_CATALOG.find((entry) => entry.id === id);
}

export interface ShortcutConflict {
  a: string;
  b: string;
  combo: string;
}

/**
 * Two entries conflict when their EFFECTIVE combo (override ?? default) is the same string and
 * their scopes can plausibly both be active at once — always true for "global" (it's active
 * everywhere), otherwise only when the scopes are literally the same. Pure, so both the catalog's
 * own "no built-in conflicts" test and the live rebind-UI warning use the exact same rule.
 */
export function findShortcutConflicts(
  entries: readonly { id: string; scope: ShortcutScope; combo: string }[]
): ShortcutConflict[] {
  const conflicts: ShortcutConflict[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i]!;
      const b = entries[j]!;
      const comboA = normalizeCombo(a.combo);
      const comboB = normalizeCombo(b.combo);
      if (comboA === "" || comboA !== comboB) continue;
      if (a.scope !== b.scope && a.scope !== "global" && b.scope !== "global") continue;
      conflicts.push({ a: a.id, b: b.id, combo: comboA });
    }
  }
  return conflicts;
}

/** `overrides` maps id → combo string (or "" to mean "disabled", never the default). */
export function effectiveCombo(def: ShortcutDef, overrides: Readonly<Record<string, string>>): string {
  const override = overrides[def.id];
  return override !== undefined ? override : def.defaultCombo;
}

export function catalogConflicts(overrides: Readonly<Record<string, string>>): ShortcutConflict[] {
  return findShortcutConflicts(SHORTCUT_CATALOG.map((def) => ({ id: def.id, scope: def.scope, combo: effectiveCombo(def, overrides) })));
}

/**
 * ORION-06 — Shortcut Manager core: pure combo parsing/matching/formatting, no DOM, no React.
 * A combo is a normalized string like "mod+shift+k" ("mod" = Ctrl on Windows/Linux, ⌘ on macOS,
 * matching `useHotkey`'s existing convention in packages/ui/src/hooks.ts so this reads the same
 * events the same way). Order inside the string never matters — `normalizeCombo` is the canonical
 * form everything else (storage, conflict detection, display) is compared through.
 */

export interface ParsedCombo {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** Always lowercase: "b", "escape", "arrowup", … */
  key: string;
}

export interface MinimalKeyboardEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const MODIFIER_KEYS = new Set(["Control", "Meta", "Shift", "Alt", "AltGraph", "OS"]);

export function parseCombo(combo: string): ParsedCombo {
  const parts = combo
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return {
    mod: parts.includes("mod"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    key: parts.filter((part) => part !== "mod" && part !== "shift" && part !== "alt").pop() ?? ""
  };
}

/** Canonical string form — same combo written in a different modifier order compares equal. */
export function normalizeCombo(combo: string): string {
  const parsed = parseCombo(combo);
  if (parsed.key === "") return "";
  const parts: string[] = [];
  if (parsed.mod) parts.push("mod");
  if (parsed.shift) parts.push("shift");
  if (parsed.alt) parts.push("alt");
  parts.push(parsed.key);
  return parts.join("+");
}

export function comboMatchesEvent(combo: string, event: MinimalKeyboardEvent): boolean {
  const parsed = parseCombo(combo);
  if (parsed.key === "") return false;
  const mod = event.metaKey || event.ctrlKey;
  if (parsed.mod !== mod) return false;
  if (parsed.shift !== event.shiftKey) return false;
  if (parsed.alt !== event.altKey) return false;
  return event.key.toLowerCase() === parsed.key;
}

/**
 * Builds a combo string from a captured keystroke (the "press a key" control in settings).
 * `null` while only modifier keys are held — the capture isn't a combo yet, keep waiting.
 */
export function comboFromEvent(event: MinimalKeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.shiftKey) parts.push("shift");
  if (event.altKey) parts.push("alt");
  parts.push(event.key.toLowerCase());
  return parts.join("+");
}

const SPECIAL_KEY_LABELS: Record<string, string> = {
  " ": "Пробел",
  escape: "Esc",
  enter: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→"
};

function keyLabel(key: string): string {
  const special = SPECIAL_KEY_LABELS[key];
  if (special) return special;
  return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
}

/** Human-readable label for tooltips/settings — "mod+shift+k" → "Ctrl+Shift+K" (⌘⇧K on macOS). */
export function describeCombo(combo: string, isMac = false): string {
  const parsed = parseCombo(combo);
  if (parsed.key === "") return "";
  const parts: string[] = [];
  if (parsed.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (parsed.alt) parts.push(isMac ? "⌥" : "Alt");
  if (parsed.shift) parts.push(isMac ? "⇧" : "Shift");
  parts.push(keyLabel(parsed.key));
  return parts.join(isMac ? "" : "+");
}

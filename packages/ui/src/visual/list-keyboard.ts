/** What a closed or open list should do with one key. Space chooses only for a button menu, not a text combobox. */
export type ListKeyAction = "open" | "next" | "prev" | "first" | "last" | "choose" | "close" | "tab" | "none";

export function glideMenuAction(key: string, open: boolean): ListKeyAction {
  if (key === "Escape") return open ? "close" : "none";
  if (key === "Tab") return open ? "tab" : "none";
  if (key === "ArrowDown") return open ? "next" : "open";
  if (key === "ArrowUp") return open ? "prev" : "open";
  if (key === "Home") return open ? "first" : "none";
  if (key === "End") return open ? "last" : "none";
  if (key === "Enter" || key === " ") return open ? "choose" : "open";
  return "none";
}

export function comboboxMenuAction(key: string, open: boolean): ListKeyAction {
  if (key === "Escape") return open ? "close" : "none";
  if (key === "Tab") return open ? "tab" : "none";
  if (key === "ArrowDown") return open ? "next" : "open";
  if (key === "ArrowUp") return open ? "prev" : "open";
  if (key === "Home") return open ? "first" : "none";
  if (key === "End") return open ? "last" : "none";
  if (key === "Enter") return open ? "choose" : "none";
  return "none";
}

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index));
}

export function stepIndex(index: number, length: number, delta: number): number {
  return clampIndex(index + delta, length);
}

/** Next label that starts with the typed letter, wrapping past the current row. */
export function typeaheadIndex(labels: readonly string[], from: number, letter: string): number {
  if (labels.length === 0 || letter.length !== 1) return from;
  const needle = letter.toLocaleLowerCase();
  for (let step = 1; step <= labels.length; step += 1) {
    const index = (from + step) % labels.length;
    if (labels[index]?.toLocaleLowerCase().startsWith(needle)) return index;
  }
  return from;
}

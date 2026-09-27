/**
 * Pure decision logic for `useFocusTrap` (see `overlays.tsx`), split out so it
 * can be unit-tested without jsdom: it takes plain data (the already-queried
 * focusable nodes, the current active element, a Tab/Shift+Tab flag) and
 * returns what should happen next, with no DOM querying or event listeners
 * of its own. `overlays.tsx` wires this to `document`/`ref.current` and to
 * `event.preventDefault()`/`.focus()`.
 *
 * S12 (design foundations): overlays (Modal/Sheet) already implemented a Tab
 * trap and opener-focus-restore, but neither had a test — this makes the
 * trap's wrap-around behavior verifiable in the packages/**\/*.test.ts suite.
 */
export type FocusTrapAction =
  | { type: "none" }
  /** No focusable descendant — keep focus on the container itself. */
  | { type: "focus-container" }
  /** Wrap Tab/Shift+Tab around to this node. */
  | { type: "focus-node"; node: unknown };

export function computeFocusTrapAction<T>(params: {
  /** Focusable descendants, in DOM (tab) order. */
  nodes: T[];
  /** `document.activeElement` at the time of the keydown. */
  current: T | null;
  /** True when the currently-focused element is NOT inside the container. */
  currentOutsideContainer: boolean;
  shiftKey: boolean;
}): FocusTrapAction {
  const { nodes, current, currentOutsideContainer, shiftKey } = params;
  if (nodes.length === 0) return { type: "focus-container" };

  const first = nodes[0];
  const last = nodes[nodes.length - 1];

  if (shiftKey) {
    if (current === first || currentOutsideContainer) return { type: "focus-node", node: last };
    return { type: "none" };
  }
  if (current === last || currentOutsideContainer) return { type: "focus-node", node: first };
  return { type: "none" };
}

/**
 * ADR-0003 step 4 — Ctrl/Cmd+drag by a view's header drops it into the dock as a
 * panel of its own. Pure decisions live here (no DOM globals) so they can be
 * unit-tested; the imperative glue is `panel-drag-handle.ts`.
 */

/** Panel kinds that may be dragged out of a header, and the id shape each takes (`kind:<recordId>`). */
export const DRAGGABLE_PANEL_KINDS = [
  "projectplan",
  "projectmaterials",
  "projecttasks",
  "projectaccess",
  "task",
  "note",
  "view"
] as const;
export type DraggablePanelKind = (typeof DRAGGABLE_PANEL_KINDS)[number];

/**
 * Anything matching this is a control or a data surface: pressing on it with
 * Ctrl must keep its own meaning (caret placement, text selection, a click on a
 * button, a calendar event), never start a panel drag.
 */
export const NO_PANEL_DRAG_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "table",
  "[contenteditable]:not([contenteditable='false'])",
  ".cm-editor",
  "[role='button']",
  "[role='grid']",
  "[role='gridcell']",
  "[role='textbox']",
  "[data-no-panel-drag]"
].join(",");

/** Minimal shape of a DOM element for the checks below (so tests need no DOM). */
export interface ClosestCapable {
  closest(selector: string): unknown;
}

/**
 * True when the press landed on a control/data surface that is not the handle
 * itself (a tab button may be its own handle; a header's inner buttons may not).
 */
export function isBlockedDragTarget(target: ClosestCapable | null, handle: unknown): boolean {
  if (!target) return true;
  const hit = target.closest(NO_PANEL_DRAG_SELECTOR);
  return hit !== null && hit !== undefined && hit !== handle;
}

export function isMacPlatform(platform: string | undefined): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform ?? "");
}

export interface DragStartInput {
  /** `MouseEvent.button` — 0 is the primary button. */
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  isMac: boolean;
  /** Result of `isBlockedDragTarget`. */
  blockedTarget: boolean;
}

/**
 * What a press on a view's handle will do if it turns into a drag:
 *  - `"dock"`   plain drag — the view becomes a panel INSIDE the app, where it is dropped
 *               (and, like a browser tab, an OS window if it is dropped outside the app window);
 *  - `"window"` Ctrl (Cmd on macOS) + drag — an OS window at the drop point, wherever that is;
 *  - `null`     not a drag: a non-primary button, other modifiers, or a control / data surface.
 * HTML5 drag only starts after the pointer moves, so a plain click keeps working.
 */
export function panelDragMode(input: DragStartInput): "dock" | "window" | null {
  if (input.button !== 0) return null;
  if (input.blockedTarget) return null;
  if (input.shiftKey || input.altKey) return null;
  const modifier = input.isMac ? input.metaKey && !input.ctrlKey : input.ctrlKey && !input.metaKey;
  const wrongModifier = input.isMac ? input.ctrlKey : input.metaKey;
  if (wrongModifier) return null;
  return modifier ? "window" : "dock";
}

export interface DragEndInput {
  mode: "dock" | "window";
  /** `dataTransfer.dropEffect` at `dragend`: "none" = nobody in this page accepted the drop. */
  dropEffect: string;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  innerWidth: number;
  innerHeight: number;
}

/**
 * Where an OS window should open after a drag ended, or null for "do nothing".
 * `window` mode opens at the drop point whatever it was (it is the explicit «в окно»); `dock` mode only
 * when the view was dropped OUTSIDE the app window (another monitor, the desktop). A cancelled drag
 * (Esc) reports 0,0 and never opens anything; a drop the dock accepted (`dropEffect !== "none"`) is not ours.
 */
export function dragEndWindowTarget(input: DragEndInput): { x: number; y: number } | null {
  if (input.dropEffect !== "none") return null;
  if (input.screenX === 0 && input.screenY === 0) return null;
  const outside = input.clientX < 0 || input.clientY < 0 || input.clientX > input.innerWidth || input.clientY > input.innerHeight;
  if (input.mode === "dock" && !outside) return null;
  return { x: input.screenX, y: input.screenY };
}

/** Builds the dock panel id (`kind:recordId`); null for an unknown kind or an unusable id. */
export function buildPanelDragId(kind: string, recordId: string | null | undefined): string | null {
  if (!(DRAGGABLE_PANEL_KINDS as readonly string[]).includes(kind)) return null;
  const id = (recordId ?? "").trim();
  if (!id || id.includes(":") || /\s/.test(id)) return null;
  return `${kind}:${id}`;
}

/** Validates an already-built id (e.g. from a `data-panel-drag` attribute). */
export function isDraggablePanelId(panelId: string | null | undefined): panelId is string {
  if (!panelId) return false;
  const at = panelId.indexOf(":");
  return at > 0 && buildPanelDragId(panelId.slice(0, at), panelId.slice(at + 1)) === panelId;
}

export function panelDragHint(isMac: boolean): string {
  return `Перетащите — откроется панелью в приложении (за пределами окна — отдельным окном); ${isMac ? "Cmd" : "Ctrl"}+перетаскивание — отдельным окном. С клавиатуры: меню «Вынести» / «Действия»`;
}

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
 * Arm a drag only for primary button + the platform's modifier (Ctrl, or Cmd on
 * macOS where Ctrl+click is a right click) on a non-interactive spot. A plain
 * press never arms it, so ordinary clicks and Ctrl+click keep working.
 */
export function shouldStartPanelDrag(input: DragStartInput): boolean {
  if (input.button !== 0) return false;
  if (input.blockedTarget) return false;
  if (input.shiftKey || input.altKey) return false;
  return input.isMac ? input.metaKey && !input.ctrlKey : input.ctrlKey && !input.metaKey;
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
  return `${isMac ? "Cmd" : "Ctrl"}+перетаскивание — открыть панелью. С клавиатуры: меню «Действия» → «Открыть панелью»`;
}

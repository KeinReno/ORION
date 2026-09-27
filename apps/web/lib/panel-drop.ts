/**
 * U06 (24-CONNECTED-CORE-BACKLOG.md) — pure helpers behind the sidebar
 * drag→Dockview feature, kept dependency-free from dockview/react so they
 * can be unit-tested without a live DockviewApi/DOM. The imperative wiring
 * (actual `addPanel`/`setActive` calls) lives in `app/(app)/layout.tsx` and
 * calls into these.
 */

/**
 * Custom drag MIME type carried on `DataTransfer` when the user starts
 * dragging a sidebar link. dockview's own internal panel-to-panel drags use
 * their own `PanelTransfer` payload (see dockview-core's `dnd/dataTransfer`)
 * and never carry this type, so checking for it is how ORION's drop
 * handlers in `layout.tsx` tell "a sidebar section is being dropped here"
 * apart from "an existing dockview tab is being reordered" — the two must
 * not be handled by the same code path, or dragging an already-open tab
 * around the dock would misfire panel-open logic.
 */
export const ORION_PANEL_DRAG_MIME = "application/x-orion-panel-id";

/**
 * `DragEvent.dataTransfer.types` is readable during `dragenter`/`dragover`
 * (before drop) in every evergreen browser, but `.getData()` is not — only
 * `.types` is guaranteed pre-drop. Overlay/accept decisions must use this,
 * `readDraggedPanelId` (which calls `.getData()`) is only safe to call from
 * the `drop` event itself.
 */
export function isOrionPanelDragEvent(nativeEvent: DragEvent): boolean {
  const types = nativeEvent.dataTransfer?.types;
  if (!types) return false;
  // `types` is a DOMStringList in some environments (not a real array),
  // hence `Array.prototype.includes.call` instead of `.includes` directly.
  return Array.prototype.includes.call(types, ORION_PANEL_DRAG_MIME);
}

/** Only valid on a `drop` event (see `isOrionPanelDragEvent` doc above). */
export function readDraggedPanelId(nativeEvent: DragEvent): string | null {
  const value = nativeEvent.dataTransfer?.getData(ORION_PANEL_DRAG_MIME);
  return value ? value : null;
}

export type PanelDropAction =
  | { kind: "focus" }
  | { kind: "unknown-panel" }
  | { kind: "module-disabled" }
  | { kind: "create" };

/**
 * Duplicate/focus policy (U06 done-criterion): dragging a sidebar section
 * that's already open anywhere in the dock NEVER creates a second copy of
 * it — it focuses the existing tab, exactly like a plain sidebar click
 * (`openPanel` in layout.tsx). This is a deliberate simplification over
 * "move the existing tab to the drop zone": moving would need dockview's
 * panel-relocation API exercised against real drop geometry, which this
 * session has no browser to verify visually — focus-only is the smaller,
 * predictable, already-tested surface (mirrors click semantics exactly).
 * A drop that lands on a disabled module or an unknown panel id is a no-op,
 * matching `openPanel`'s existing guard in layout.tsx.
 */
export function resolveDropAction(
  panelId: string | null,
  knownPanelIds: ReadonlySet<string>,
  disabledModulePanelIds: ReadonlySet<string>,
  openPanelIds: ReadonlySet<string>
): PanelDropAction {
  if (!panelId || !knownPanelIds.has(panelId)) return { kind: "unknown-panel" };
  if (disabledModulePanelIds.has(panelId)) return { kind: "module-disabled" };
  if (openPanelIds.has(panelId)) return { kind: "focus" };
  return { kind: "create" };
}

/**
 * URL for opening a panel directly in its own window/tab — used both by the
 * existing Tauri `DetachHeaderAction` (for an already-open panel) and by the
 * new sidebar-item "Открыть в новом окне" command (U06: must work WITHOUT
 * first opening the panel in the current window — "команда открытия на
 * втором мониторе обязательна"). `workspaceId` is optional because a plain
 * browser `window.open` on the same origin inherits `sessionStorage`
 * (and therefore the window's active workspace) natively — only the Tauri
 * path (a brand-new webview with empty storage, see `window-context.ts`)
 * strictly needs it seeded via the query string.
 */
export function panelWindowUrl(panelId: string, workspaceId?: string | null): string {
  // An instanced panel (`project:<id>`) maps onto the static `/panel/project`
  // route plus `?instance=` — the desktop build is a static export, so the
  // record id cannot be a path segment (see app/panel/[panelId]/page.tsx).
  const at = panelId.indexOf(":");
  const kind = at === -1 ? panelId : panelId.slice(0, at);
  const query: string[] = [];
  if (at !== -1) query.push(`instance=${encodeURIComponent(panelId.slice(at + 1))}`);
  if (workspaceId) query.push(`workspaceId=${encodeURIComponent(workspaceId)}`);
  return query.length > 0 ? `/panel/${kind}?${query.join("&")}` : `/panel/${kind}`;
}

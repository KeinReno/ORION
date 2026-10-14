import { isTauri } from "./is-tauri";
import { panelWindowUrl } from "./panel-drop";
import { getActiveWorkspaceId } from "./use-active-workspace";

/**
 * "Открыть пространство в новом окне" — a whole new shell for another workspace
 * (the second-monitor case). The id travels in `?workspaceId=` because a new
 * window's sessionStorage, and with it its active workspace, starts empty; the
 * new window seeds from it once (see the seed effect in AppLayout).
 */
export async function openWorkspaceInNewWindow(workspaceId: string, title: string): Promise<void> {
  const url = `/dashboard?workspaceId=${encodeURIComponent(workspaceId)}`;
  if (isTauri()) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    new WebviewWindow(`workspace-${Date.now()}`, { url, title: `ORION — ${title}`, width: 1280, height: 800 });
  } else {
    window.open(url, `orion-workspace-${Date.now()}`, "width=1280,height=800");
  }
}

/**
 * Opens a panel directly in its own window, without it ever needing to be
 * open in the current Workbench first — shared by `DetachHeaderAction`
 * (Tauri "открепить" on an already-open tab) and, since U06, the sidebar
 * item's own "Открыть в новом окне" command, which must work standalone
 * (24-CONNECTED-CORE-BACKLOG.md U06: "команда открытия на втором мониторе
 * обязательна"). In Tauri this is a real native `WebviewWindow` (see the
 * U04 comment below on why `?workspaceId=` is carried explicitly). In a
 * plain browser it's `window.open` — the same underlying mechanism
 * dockview's own built-in popout already uses there, just reachable
 * without first placing the panel in this window's dock.
 */
export async function detachPanelToWindow(
  panelId: string,
  title: string,
  /** Экранные координаты (CSS px) — окно появится там, куда карточку бросили (второй монитор). */
  at?: { x: number; y: number }
): Promise<void> {
  const workspaceId = getActiveWorkspaceId();
  const url = panelWindowUrl(panelId, workspaceId);
  if (isTauri()) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    // U04: a detached Tauri WebviewWindow is a brand new webview instance —
    // its `sessionStorage` (and therefore its `windowId`, see
    // `window-context.ts`) starts empty, so it would have no active
    // workspace of its own and `PanelWindow` would bounce it to `/spaces`.
    // Carry the CURRENT window's active workspace across explicitly via the
    // URL (read synchronously, not via the hook — this runs from an
    // imperative click handler, not a render) so the detached window opens
    // already scoped to the same workspace; from then on it is its own
    // independent window context and can be switched separately.
    new WebviewWindow(`panel-${panelId}-${Date.now()}`, {
      url,
      title,
      width: 900,
      height: 700,
      ...(at ? { x: Math.round(at.x - 450), y: Math.round(at.y - 40) } : {})
    });
  } else {
    window.open(url, `orion-panel-${panelId}-${Date.now()}`, `width=900,height=700${at ? `,left=${Math.round(at.x - 450)},top=${Math.round(at.y - 40)}` : ""}`);
  }
}

"use client";

import { usePreferences, useSession } from "@orion/core-react";
import { Sidebar, type SidebarFolderView, type SidebarLinkItem } from "@orion/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { isTauri } from "../../../lib/is-tauri";
import { openNavSidebarChannel } from "../../../lib/nav-sidebar-channel";
import { bindSectionDrag } from "../../../lib/nav-section-drag";
import { useNavDragBridge } from "../../../lib/use-nav-drag-bridge";
import {
  dockNavWindow,
  navHeartbeatKey,
  navWindowStorageKey,
  parseNavWindowState,
  rememberNavWindowBounds,
} from "../../../lib/nav-sidebar-windows";
import { panelsForSidebar, toggleNavFolder, movePanelToSidebar } from "../../../lib/sidebar-instances";
import { panelSupportsSurface, visiblePanels } from "../../../lib/panel-registry";
import { getActiveWorkspaceId, setActiveWorkspaceId, useActiveWorkspace } from "../../../lib/use-active-workspace";
import { useNavSidebars } from "../../../lib/use-nav-sidebars";

/**
 * One navigation bar in its own window. A click asks the main window to focus
 * the section. This window has no workbench of its own.
 */
export function NavSidebarWindow(): React.ReactElement | null {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sidebarId = searchParams.get("id") ?? "";
  const { user, status } = useSession();
  const { workspace, workspaces, isLoading: workspacesLoading } = useActiveWorkspace();
  const preferences = usePreferences();
  const { state, update } = useNavSidebars(user?.id, workspace?.id);
  useNavDragBridge({
    kind: "nav",
    sidebarId,
    onMove: (panelId, targetId, folderId, beforeId) => update((current) => movePanelToSidebar(current, panelId, targetId, { folderId, beforeId })),
    onOpenInside: (panelId) => {
      const channel = openNavSidebarChannel();
      channel?.postMessage({ type: "open", panelId });
      channel?.close();
    },
  });

  useEffect(() => {
    if (getActiveWorkspaceId()) return;
    const seed = searchParams.get("workspaceId");
    if (seed) setActiveWorkspaceId(seed);
  }, [searchParams]);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
    else if (status === "authenticated" && !workspacesLoading && !workspace && !workspaces.some((item) => item.id === getActiveWorkspaceId())) {
      router.replace("/spaces");
    }
  }, [router, status, workspace, workspaces, workspacesLoading]);

  useEffect(() => {
    if (!sidebarId || !user || !workspace) return;
    const key = navWindowStorageKey(user.id, workspace.id);
    const channel = openNavSidebarChannel();
    const hello = () => channel?.postMessage({ type: "hello", sidebarId });
    const beatKey = navHeartbeatKey(user.id, workspace.id);
    const beat = () => {
      hello();
      try {
        const parsed = JSON.parse(window.localStorage.getItem(beatKey) ?? "{}") as Record<string, number>;
        parsed[sidebarId] = Date.now();
        window.localStorage.setItem(beatKey, JSON.stringify(parsed));
      } catch {
        // The main window docks the bar if neither the beat nor the channel arrives.
      }
    };
    beat();
    const timer = window.setInterval(beat, 2000);
    const onMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === "ping") hello();
      if (event.data?.type === "dock") {
        if (isTauri()) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => void getCurrentWindow().close());
        else window.close();
      }
    };
    channel?.addEventListener("message", onMessage);
    const persistBounds = () => {
      try {
        const parsed = parseNavWindowState(JSON.parse(window.localStorage.getItem(key) ?? "null"));
        const next = rememberNavWindowBounds(parsed, sidebarId, {
          x: window.screenX,
          y: window.screenY,
          width: window.outerWidth,
          height: window.outerHeight,
        });
        if (next !== parsed) window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // A blocked store keeps the bar; the main window still reclaims it on silence.
      }
    };
    const giveBack = () => {
      channel?.postMessage({ type: "dock", sidebarId });
      try {
        const parsed = parseNavWindowState(JSON.parse(window.localStorage.getItem(key) ?? "null"));
        window.localStorage.setItem(key, JSON.stringify(dockNavWindow(parsed, sidebarId)));
      } catch {
        // The main window's silence check returns the bar if this write fails.
      }
    };
    window.addEventListener("resize", persistBounds);
    // A move onto another display can reload the webview. pagehide would then
    // pull the bar back into the main window, so only a real close docks it.
    const stops: Array<() => void> = [];
    let cancelled = false;
    if (isTauri()) {
      void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
        const current = getCurrentWindow();
        const handles = [
          await current.onMoved(() => persistBounds()),
          await current.onResized(() => persistBounds()),
          await current.onCloseRequested(() => giveBack()),
        ];
        if (cancelled) {
          for (const stop of handles) stop();
          return;
        }
        stops.push(...handles);
      });
    } else {
      window.addEventListener("beforeunload", giveBack);
    }
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      channel?.removeEventListener("message", onMessage);
      window.removeEventListener("resize", persistBounds);
      window.removeEventListener("beforeunload", giveBack);
      for (const stop of stops) stop();
      channel?.close();
    };
  }, [sidebarId, user, workspace]);

  const disabled = workspace?.disabledModules;
  const hidden = preferences.data?.hiddenModules;
  const panels = useMemo(
    () => visiblePanels(disabled, hidden, workspace?.pluginOverrides).filter((panel) => panel.group !== "Инструменты"),
    [disabled, hidden, workspace?.pluginOverrides],
  );
  const bar = state.sidebars.find((item) => item.id === sidebarId);
  const links: SidebarLinkItem[] = panelsForSidebar(state, sidebarId, panels.map((panel) => panel.id)).flatMap((id) => {
    const panel = panels.find((item) => item.id === id);
    if (!panel) return [];
    return [{
      id: panel.id,
      label: panel.label,
      icon: panel.icon,
      onClick: () => {
        const channel = openNavSidebarChannel();
        channel?.postMessage({ type: "open", panelId: panel.id });
        channel?.close();
      },
      ...bindSectionDrag(panel.id, panel.label, panelSupportsSurface(panel.id, "window")),
    }];
  });
  const folders: SidebarFolderView[] = (bar?.folders ?? []).map((folder) => ({
    id: folder.id,
    name: folder.name,
    collapsed: folder.collapsed,
    linkIds: folder.items,
  }));

  if (!bar) return null;
  return (
    <div className="h-dvh w-screen">
      <Sidebar
        navId={bar.id}
        position="left"
        fill
        defaultPinned
        railLabel={bar.name}
        links={links}
        folders={folders}
        onToggleFolder={(id) => update((current) => toggleNavFolder(current, bar.id, id))}
        onMoveLink={(panelId, folderId, beforeId) => update((current) => movePanelToSidebar(current, panelId, bar.id, { folderId, beforeId }))}
      />
    </div>
  );
}

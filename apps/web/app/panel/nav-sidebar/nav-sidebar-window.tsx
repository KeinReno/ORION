"use client";

import { usePreferences, useSession } from "@orion/core-react";
import { Sidebar, type SidebarFolderView, type SidebarLinkItem } from "@orion/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { openNavSidebarChannel } from "../../../lib/nav-sidebar-channel";
import {
  navWindowStorageKey,
  parseNavWindowState,
  rememberNavWindowBounds,
  dockNavWindow,
} from "../../../lib/nav-sidebar-windows";
import { panelsForSidebar, toggleNavFolder, movePanelToSidebar } from "../../../lib/sidebar-instances";
import { visiblePanels } from "../../../lib/panel-registry";
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
    hello();
    const timer = window.setInterval(hello, 2000);
    const onMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === "ping") hello();
      if (event.data?.type === "dock") window.close();
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
    window.addEventListener("pagehide", giveBack);
    return () => {
      window.clearInterval(timer);
      channel?.removeEventListener("message", onMessage);
      window.removeEventListener("resize", persistBounds);
      window.removeEventListener("pagehide", giveBack);
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
    <div className="h-dvh">
      <Sidebar
        navId={bar.id}
        position="left"
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

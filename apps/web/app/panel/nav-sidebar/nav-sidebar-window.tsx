"use client";

import { usePreferences, useSession } from "@orion/core-react";
import { ConfirmDialog, LoadingScreen, Sidebar, Workbench, useToast, type DockviewApi, type DockviewReadyEvent, type MenuItem, type SidebarFolderView, type SidebarLinkItem } from "@orion/ui";
import { Folder, FolderPlus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentPresenceFeed } from "../../../lib/agent-presence";
import { FolderNameDialog } from "../../../components/folder-name-dialog";
import { dockLayoutStorageKey } from "../../../lib/dock-layout-key";
import { sanitizeDockLayout } from "../../../lib/dock-layout-sanitize";
import { buildPanelComponents } from "../../../lib/panel-components";
import { isTauri } from "../../../lib/is-tauri";
import { openNavSidebarChannel } from "../../../lib/nav-sidebar-channel";
import { bindSectionDrag } from "../../../lib/nav-section-drag";
import { useNavDragBridge } from "../../../lib/use-nav-drag-bridge";
import {
  dockNavWindow,
  dockMessageTargetsSidebar,
  navHeartbeatKey,
  navWindowStorageKey,
  parseNavWindowState,
  rememberNavWindowBounds,
  rememberNavWorkspaceBounds,
} from "../../../lib/nav-sidebar-windows";
import {
  PRIMARY_SIDEBAR_ID,
  addNavFolder,
  deleteNavFolder,
  moveNavFolder,
  movePanelToSidebar,
  panelsForSidebar,
  renameNavFolder,
  seedDefaultNavFolders,
  toggleNavFolder,
} from "../../../lib/sidebar-instances";
import { getPanelDefinition, isPanelAvailable, panelInstanceId, panelRegistry, panelSupportsSurface, visiblePanels } from "../../../lib/panel-registry";
import { registerPanelBus } from "../../../lib/panel-bus";
import { objectViewPanel } from "../../../lib/object-view";
import { monitorIdentity, windowDisplayRelation } from "../../../lib/display-geometry";
import { readDisplays } from "../../../lib/read-displays";
import { useEnabledModules } from "../../../lib/use-enabled-modules";
import { hasUnsavedDrafts } from "../../../lib/unsaved-drafts";
import { getActiveWorkspaceId, setActiveWorkspaceId, useActiveWorkspace } from "../../../lib/use-active-workspace";
import { useNavSidebars } from "../../../lib/use-nav-sidebars";
import { newFolderId } from "../../../lib/use-sidebar-folders";

const panelComponents = buildPanelComponents();

/**
 * A detached navigation bar gets a local Workbench only on a different
 * display. On the same display it retains the compact behavior and routes
 * clicks to the existing host Workbench.
 */
export function NavSidebarWindow(): React.ReactElement | null {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sidebarId = searchParams.get("id") ?? "";
  const { user, status, isLoading, retry: retrySession } = useSession();
  const { workspace, workspaces, isLoading: workspacesLoading } = useActiveWorkspace();
  const preferences = usePreferences();
  const { disabledModules } = useEnabledModules();
  const pluginOverrides = useMemo(() => workspace?.pluginOverrides ?? [], [workspace]);
  const [displayRelation, setDisplayRelation] = useState<"same" | "different" | "unknown">("unknown");
  const lastKnownRelationRef = useRef<"same" | "different" | null>(null);
  const [hasLocalWorkbench, setHasLocalWorkbench] = useState(false);
  const [pendingPanelClose, setPendingPanelClose] = useState<string | null>(null);
  const [confirmWindowClose, setConfirmWindowClose] = useState(false);
  const allowCloseRef = useRef(false);
  const dockCloseRef = useRef(false);
  const apiRef = useRef<DockviewApi | null>(null);
  const pendingOpenRef = useRef<{ panelId: string; title?: string } | null>(null);
  const { state, update } = useNavSidebars(user?.id, workspace?.id);
  const { toast } = useToast();
  const [folderDialog, setFolderDialog] = useState<{ mode: "create"; panelId?: string } | { mode: "rename"; id: string; name: string } | null>(null);
  const defaultNavPanels = useMemo(
    () => panelRegistry.filter((panel) => !panel.hideFromNav).map(({ id, group }) => ({ id, group })),
    [],
  );
  const primaryDefaultFoldersSeeded = state.sidebars.find((bar) => bar.id === PRIMARY_SIDEBAR_ID)?.defaultFoldersSeeded;
  useEffect(() => {
    if (sidebarId !== PRIMARY_SIDEBAR_ID) return;
    update((current) => seedDefaultNavFolders(current, PRIMARY_SIDEBAR_ID, defaultNavPanels));
  }, [defaultNavPanels, primaryDefaultFoldersSeeded, sidebarId, update]);
  const openPanel = useCallback((panelId: string, title?: string) => {
    const definition = getPanelDefinition(panelId);
    if (!definition || !isPanelAvailable(definition, disabledModules, pluginOverrides)) return;
    const api = apiRef.current;
    if (!api) {
      pendingOpenRef.current = { panelId, ...(title ? { title } : {}) };
      return;
    }
    const existing = api.getPanel(panelId);
    if (existing) return void existing.api.setActive();
    const instanceId = panelInstanceId(panelId);
    api.addPanel({ id: panelId, component: definition.id, title: title ?? definition.label, ...(instanceId ? { params: { instanceId } } : {}) });
  }, [disabledModules, pluginOverrides]);
  useNavDragBridge({
    kind: "nav",
    sidebarId,
    hasWorkbench: displayRelation === "different",
    onMove: (panelId, targetId, folderId, beforeId) => update((current) => movePanelToSidebar(current, panelId, targetId, { folderId, beforeId })),
    onOpenInside: (panelId) => {
      if (displayRelation === "different") openPanel(panelId);
      else if (displayRelation === "same") {
        const channel = openNavSidebarChannel();
        channel?.postMessage({ type: "open", panelId });
        channel?.close();
      }
    },
  });

  useEffect(() => registerPanelBus({
    openPanel,
    openObject: (view, _mode, title) => {
      const panelId = objectViewPanel(view, getActiveWorkspaceId());
      if (panelId) openPanel(panelId, title);
    }
  }), [openPanel]);

  const onWorkbenchReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    if (!user || !workspace) return;
    const key = dockLayoutStorageKey(user.id, workspace.id, `nav-${sidebarId}`);
    try {
      const raw = window.localStorage.getItem(key);
      const clean = raw ? sanitizeDockLayout(JSON.parse(raw), (id) => Boolean(getPanelDefinition(id)), { width: window.innerWidth, height: window.innerHeight }) : null;
      if (clean) event.api.fromJSON(clean.layout as unknown as Parameters<DockviewApi["fromJSON"]>[0]);
    } catch {
      /* a damaged saved layout starts empty */
    }
    event.api.onDidLayoutChange(() => {
      try { window.localStorage.setItem(key, JSON.stringify(event.api.toJSON())); } catch { /* retry on the next layout change */ }
    });
    const pending = pendingOpenRef.current;
    pendingOpenRef.current = null;
    if (pending) openPanel(pending.panelId, pending.title);
  }, [openPanel, sidebarId, user, workspace]);

  // The detached window carries the host's screen rectangle in its URL. On
  // another monitor it expands into its own workspace; moving it back shrinks
  // it to the original navigation-only behavior. Tauri uses native monitor
  // identity so mixed-DPI virtual desktop origins are never compared here.
  useEffect(() => {
    let host = {
      x: Number(searchParams.get("hostX")), y: Number(searchParams.get("hostY")),
      width: Number(searchParams.get("hostWidth")), height: Number(searchParams.get("hostHeight"))
    };
    if (!Object.values(host).every(Number.isFinite) || host.width <= 0 || host.height <= 0) return;
    let hostMonitor = searchParams.get("hostMonitor");
    let cancelled = false;
    let checkSequence = 0;
    let resizeWindow: ((remote: boolean) => Promise<void>) | null = null;
    const check = async () => {
      const sequence = ++checkSequence;
      const hostSnapshot = host;
      const hostMonitorSnapshot = hostMonitor;
      const displays = await readDisplays();
      if (cancelled || sequence !== checkSequence) return;
      const own = { x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight };
      let relation = windowDisplayRelation(hostSnapshot, own, displays);
      if (isTauri()) {
        if (!hostMonitorSnapshot) {
          relation = "unknown";
        } else try {
          const { currentMonitor } = await import("@tauri-apps/api/window");
          const ownMonitor = monitorIdentity(await currentMonitor());
          if (cancelled || sequence !== checkSequence) return;
          if (ownMonitor) relation = ownMonitor === hostMonitorSnapshot ? "same" : "different";
          else {
            relation = "unknown";
            console.warn("[nav-sidebar] Native monitor identity is unavailable; sidebar routing is paused.");
          }
        } catch (error) {
          if (cancelled || sequence !== checkSequence) return;
          relation = "unknown";
          console.warn("[nav-sidebar] Could not read native monitor identity; sidebar routing is paused.", error);
        }
      }
      if (relation === "unknown") {
        if (!isTauri()) relation = lastKnownRelationRef.current ?? relation;
      } else {
        lastKnownRelationRef.current = relation;
        if (relation === "different") setHasLocalWorkbench(true);
      }
      setDisplayRelation(relation);
      if (relation !== "unknown") {
        try { await resizeWindow?.(relation === "different"); }
        catch (error) { console.warn("[nav-sidebar] Could not apply display-specific window size.", error); }
      }
    };
    void check();
    if (isTauri()) {
      let stopMoved: (() => void) | null = null;
      const stopsForHost: Array<() => void> = [];
      void Promise.all([import("@tauri-apps/api/window"), import("@tauri-apps/api/dpi")]).then(async ([windowApi, dpi]) => {
        const current = windowApi.getCurrentWindow();
        resizeWindow = async (remote) => {
          const monitor = await windowApi.currentMonitor();
          const scale = monitor?.scaleFactor || 1;
          const maxWidth = monitor?.workArea ? monitor.workArea.size.width / scale - 48 : window.screen.availWidth - 48;
          const maxHeight = monitor?.workArea ? monitor.workArea.size.height / scale - 48 : window.screen.availHeight - 48;
          const width = remote
            ? Math.min(Math.max(280, window.outerWidth < 800 ? 1280 : window.outerWidth), Math.max(280, maxWidth))
            : 280;
          const height = Math.min(Math.max(480, window.outerHeight), Math.max(480, maxHeight));
          if (Math.abs(window.outerWidth - width) > 8 || Math.abs(window.outerHeight - height) > 8) {
            await current.setSize(new dpi.LogicalSize(width, height));
          }
        };
        stopMoved = await current.onMoved(() => void check());
        const channel = openNavSidebarChannel();
        const onHostBounds = (event: MessageEvent<{ type?: string; sidebarId?: string; bounds?: { x: number; y: number; width: number; height: number }; monitorId?: string }>) => {
          const next = event.data;
          if (next?.type !== "host-bounds" || next.sidebarId !== sidebarId || !next.bounds) return;
          if (!Object.values(next.bounds).every(Number.isFinite) || next.bounds.width <= 0 || next.bounds.height <= 0) return;
          host = next.bounds;
          hostMonitor = next.monitorId ?? null;
          void check();
        };
        channel?.addEventListener("message", onHostBounds);
        if (cancelled) stopMoved();
        else await check();
        if (cancelled) channel?.close();
        else stopsForHost.push(() => { channel?.removeEventListener("message", onHostBounds); channel?.close(); });
      });
      return () => { cancelled = true; stopMoved?.(); for (const stop of stopsForHost) stop(); };
    }
    window.addEventListener("resize", check);
    return () => { cancelled = true; window.removeEventListener("resize", check); };
  }, [searchParams, sidebarId]);

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
    const onMessage = (event: MessageEvent<{ type?: string; sidebarId?: string }>) => {
      if (event.data?.type === "ping") hello();
      if (dockMessageTargetsSidebar(event.data ?? {}, sidebarId)) {
        if (hasUnsavedDrafts()) {
          dockCloseRef.current = true;
          setConfirmWindowClose(true);
          return;
        }
        if (isTauri()) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => void getCurrentWindow().close());
        else window.close();
      }
    };
    channel?.addEventListener("message", onMessage);
    const persistBounds = () => {
      try {
        const parsed = parseNavWindowState(JSON.parse(window.localStorage.getItem(key) ?? "null"));
        const currentBounds = {
          x: window.screenX,
          y: window.screenY,
          width: window.outerWidth,
          height: window.outerHeight,
        };
        const next = displayRelation === "different"
          ? rememberNavWorkspaceBounds(parsed, sidebarId, currentBounds)
          : rememberNavWindowBounds(parsed, sidebarId, currentBounds);
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
          await current.onCloseRequested((event) => {
            if (allowCloseRef.current) {
              giveBack();
              return;
            }
            if (hasUnsavedDrafts()) {
              event.preventDefault();
              setConfirmWindowClose(true);
              return;
            }
            giveBack();
          }),
        ];
        if (cancelled) {
          for (const stop of handles) stop();
          return;
        }
        stops.push(...handles);
      });
    } else {
      const beforeUnload = (event: BeforeUnloadEvent) => {
        if (hasUnsavedDrafts()) {
          event.preventDefault();
          event.returnValue = "";
          return;
        }
        giveBack();
      };
      window.addEventListener("beforeunload", beforeUnload);
      return () => {
        cancelled = true;
        window.clearInterval(timer);
        channel?.removeEventListener("message", onMessage);
        window.removeEventListener("resize", persistBounds);
        window.removeEventListener("beforeunload", beforeUnload);
        for (const stop of stops) stop();
        channel?.close();
      };
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
  }, [displayRelation, sidebarId, user, workspace]);

  const disabled = workspace?.disabledModules;
  const hidden = preferences.data?.hiddenModules;
  const panels = useMemo(
    () => visiblePanels(disabled, hidden, workspace?.pluginOverrides).filter((panel) => panel.group !== "Инструменты"),
    [disabled, hidden, workspace?.pluginOverrides],
  );
  const bar = state.sidebars.find((item) => item.id === sidebarId);
  const otherBars = state.sidebars.filter((item) => item.id !== sidebarId);
  function showPanel(panelId: string): void {
    if (displayRelation === "different") openPanel(panelId);
    else if (displayRelation === "same") {
      const channel = openNavSidebarChannel();
      channel?.postMessage({ type: "open", panelId });
      channel?.close();
    }
  }
  const links: SidebarLinkItem[] = panelsForSidebar(state, sidebarId, panels.map((panel) => panel.id)).flatMap((id) => {
    const panel = panels.find((item) => item.id === id);
    if (!panel) return [];
    return [{
      id: panel.id,
      label: panel.label,
      icon: panel.icon,
      onClick: () => showPanel(panel.id),
      ...bindSectionDrag(panel.id, panel.label, panelSupportsSurface(panel.id, "window")),
      menuItems: [
        { label: "Открыть", onSelect: () => showPanel(panel.id) },
        ...(otherBars.length > 0
          ? [
              "separator" as const,
              ...otherBars.map((targetBar) => ({
                label: `Переместить в сайдбар «${targetBar.name}»`,
                onSelect: () => update((current) => movePanelToSidebar(current, panel.id, targetBar.id)),
              })),
            ]
          : []),
        "separator",
        ...state.sidebars.flatMap((targetBar) =>
          targetBar.folders
            .filter((folder) => !folder.items.includes(panel.id))
            .map((folder) => ({
              label: targetBar.id === sidebarId ? `В папку «${folder.name}»` : `В папку «${folder.name}» сайдбара «${targetBar.name}»`,
              icon: Folder,
              onSelect: () => update((current) => movePanelToSidebar(current, panel.id, targetBar.id, { folderId: folder.id })),
            })),
        ),
        ...(state.sidebars.some((targetBar) => targetBar.folders.some((folder) => folder.items.includes(panel.id)))
          ? [{ label: "Убрать из папки", onSelect: () => update((current) => movePanelToSidebar(current, panel.id, sidebarId, { folderId: null })) }]
          : []),
        { label: "В новую папку…", icon: FolderPlus, onSelect: () => setFolderDialog({ mode: "create", panelId: panel.id }) },
      ] satisfies (MenuItem | "separator")[],
    }];
  });
  const visible = new Set(panels.map((panel) => panel.id));
  const folders: SidebarFolderView[] = (bar?.folders ?? []).map((folder, index, allFolders) => ({
    id: folder.id,
    name: folder.name,
    collapsed: folder.collapsed,
    linkIds: folder.items.filter((id) => visible.has(id)),
    menuItems: [
      { label: "Переименовать…", onSelect: () => setFolderDialog({ mode: "rename", id: folder.id, name: folder.name }) },
      { label: "Выше", disabled: index === 0, onSelect: () => update((current) => moveNavFolder(current, sidebarId, folder.id, -1)) },
      { label: "Ниже", disabled: index === allFolders.length - 1, onSelect: () => update((current) => moveNavFolder(current, sidebarId, folder.id, 1)) },
      "separator",
      { label: "Удалить папку", tone: "danger", onSelect: () => {
        const before = state;
        const next = deleteNavFolder(before, sidebarId, folder.id);
        if (next === before) return;
        update(() => next);
        toast({
          title: `Папка «${folder.name}» удалена`,
          description: "Разделы остались в общем списке сайдбара.",
          action: { label: "Отменить", onClick: () => update(() => before) },
        });
      } },
    ],
  }));

  const requestPanelClose = (panelId: string) => {
    if (hasUnsavedDrafts(panelId)) setPendingPanelClose(panelId);
    else apiRef.current?.getPanel(panelId)?.api.close();
  };

  const closeWindowAfterConfirm = () => {
    allowCloseRef.current = true;
    if (isTauri()) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => void getCurrentWindow().close());
    else window.close();
  };

  if (status === "unavailable") return <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground"><p>Не удаётся связаться с сервером.</p><button type="button" onClick={retrySession} className="rounded-lg border border-border px-3 py-1.5 text-foreground hover:bg-white/5">Повторить</button></div>;
  if (isLoading || !user || workspacesLoading || !workspace) return <LoadingScreen />;

  if (!bar) return null;
  return (
    <div data-display-route={displayRelation} className={displayRelation === "different" ? "flex h-dvh w-full overflow-hidden" : "h-dvh w-screen"}>
      {displayRelation === "different" ? <AgentPresenceFeed /> : null}
      <div className={displayRelation === "different" ? "h-full w-[280px] shrink-0" : "h-dvh w-screen"}>
      <Sidebar
        navId={bar.id}
        position="left"
        fill
        defaultPinned
        railLabel={bar.name}
        links={links}
        folders={folders}
        surfaceMenuItems={[{ label: "Новая папка…", onSelect: () => setFolderDialog({ mode: "create" }) }]}
        onToggleFolder={(id) => update((current) => toggleNavFolder(current, bar.id, id))}
        onCreateFolder={(panelId) => setFolderDialog({ mode: "create", panelId })}
        onMoveLink={(panelId, folderId, beforeId) => update((current) => {
          const visibleIds = panelsForSidebar(current, bar.id, panels.map((panel) => panel.id));
          const catalog = visibleIds.includes(panelId) ? visibleIds : [...visibleIds, panelId];
          return movePanelToSidebar(current, panelId, bar.id, { folderId, beforeId, catalog });
        })}
      />
      </div>
      <FolderNameDialog
        open={folderDialog !== null}
        title={folderDialog?.mode === "rename" ? "Переименовать папку" : "Новая папка"}
        initial={folderDialog?.mode === "rename" ? folderDialog.name : ""}
        submitLabel={folderDialog?.mode === "rename" ? "Сохранить" : "Создать"}
        onClose={() => setFolderDialog(null)}
        onSubmit={(name) => {
          const dialog = folderDialog;
          setFolderDialog(null);
          if (!dialog) return;
          const before = state;
          const next = dialog.mode === "rename"
            ? renameNavFolder(before, sidebarId, dialog.id, name)
            : addNavFolder(before, sidebarId, name, newFolderId(), dialog.panelId);
          if (next === before) {
            toast({
              title: "Изменение не применено",
              description: dialog.mode === "create" ? "Освободите место в сайдбаре или обновите список и повторите." : "Папка уже недоступна. Откройте меню ещё раз.",
              tone: "danger",
            });
            return;
          }
          update(() => next);
          toast({ title: dialog.mode === "rename" ? `Папка переименована в «${name}»` : `Папка «${name}» создана` });
        }}
      />
      {hasLocalWorkbench ? <main className={displayRelation === "different" ? "min-w-0 flex-1 overflow-hidden" : "hidden"} aria-hidden={displayRelation !== "different"}><Workbench components={panelComponents} onReady={onWorkbenchReady} onRequestClose={requestPanelClose} /></main> : null}
      <ConfirmDialog open={pendingPanelClose !== null} title="Закрыть вкладку без сохранения?" description="В этой вкладке есть изменения, которые ещё не сохранены. При закрытии они пропадут." confirmLabel="Закрыть" onConfirm={() => { const panelId = pendingPanelClose; setPendingPanelClose(null); if (panelId) apiRef.current?.getPanel(panelId)?.api.close(); }} onCancel={() => setPendingPanelClose(null)} />
      <ConfirmDialog open={confirmWindowClose} title="Закрыть сайдбар с несохранёнными изменениями?" description="В рабочей области есть несохранённые изменения. При закрытии окна они пропадут." confirmLabel="Закрыть окно" onConfirm={() => { dockCloseRef.current = false; setConfirmWindowClose(false); closeWindowAfterConfirm(); }} onCancel={() => { setConfirmWindowClose(false); if (dockCloseRef.current) { dockCloseRef.current = false; const channel = openNavSidebarChannel(); channel?.postMessage({ type: "dock-cancelled", sidebarId }); channel?.close(); } }} />
    </div>
  );
}

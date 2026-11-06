"use client";

import { KaidenLogo } from "../../components/kaiden-logo";

import { useObjectContext, useInbox, useLogout, usePreferences, useSession, useTasks, useWorkspaceOrganization } from "@orion/core-react";
import { effectiveDisabledModules, isModuleEnabled, isTaskClosed } from "@orion/shared-types";
import {
  AppBackground,
  AutosaveStatus,
  DropdownMenu,
  IconButton,
  Sidebar,
  Sheet,
  Workbench,
  positionToDirection,
  useEscapeKey,
  useMediaQuery,
  useToast,
  type DockviewApi,
  type DockviewDidDropEvent,
  type DockviewDndOverlayEvent,
  type DockviewGroupPanel,
  type DockviewReadyEvent,
  type DockviewWillShowOverlayLocationEvent,
  type IDockviewHeaderActionsProps,
  ConfirmDialog,
  LoadingScreen,
  cx,
  useContextMenu,
  useUiSound,
  type MenuItem,
  type SidebarFolderView
} from "@orion/ui";
import { ChevronLeft, ChevronRight, Columns2, Folder, FolderPlus, LayoutTemplate, LogOut, Menu, Settings, SlidersHorizontal, PanelLeft, PanelRight, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccountAvatar } from "../../components/account-avatar";
import { CommandCenter, showCommandPalette } from "../../lib/command-center";
import { WorkspaceContext, type ProjectOpenMode } from "../../components/workspace-context";
import { ProjectContextInspector } from "../../components/project-context-inspector";
import { projectContextId } from "../../lib/shell-context";
import { NotificationBell } from "../../components/notification-bell";
import { FolderNameDialog } from "../../components/folder-name-dialog";
import { ResourcesDock, ResourcesToggle } from "../../components/resources/resources-dock";
import { ModuleSettingsSheet } from "../../components/module-settings-sheet";
import { WorkspaceSwitcher } from "../../components/workspace-switcher";
import { RunningTimerChip } from "../../components/running-timer-chip";
import { dockLayoutStorageKey } from "../../lib/dock-layout-key";
import {
  LAYOUT_NAME_MAX,
  cleanLayoutName,
  LAYOUT_SHORTCUT_COUNT,
  deleteNamedLayout,
  exportNamedLayouts,
  getDefaultLayoutName,
  getNamedLayout,
  importNamedLayouts,
  layoutShortcutIndex,
  listNamedLayouts,
  namedLayoutsKey,
  pruneDockLayout,
  renameNamedLayout,
  saveNamedLayout,
  setDefaultLayoutName
} from "../../lib/named-layouts";
import { LayoutsDialog } from "../../components/layouts-dialog";
import { isTauri } from "../../lib/is-tauri";
import { useLocalNow } from "../../lib/use-day-boundary";
import {
  ORION_PANEL_DRAG_MIME,
  isOrionPanelDragEvent,
  readDraggedPanelId,
  resolveDropAction
} from "../../lib/panel-drop";
import { openEntity, openSettings, registerPanelBus } from "../../lib/panel-bus";
import { useTaskProjectRouting } from "../../lib/task-project-routing";
import { rememberAssistantView } from "../../lib/assistant-context";
import { AgentPresenceFeed, AgentPresencePill } from "../../lib/agent-presence";
import { FeedbackButton } from "../../components/feedback-dialog";
import { GlobalCorner } from "../../components/global-corner";
import { resourceContextActions, setSectionResolver } from "../../lib/resource-context-store";
import { objectViewPanel } from "../../lib/object-view";
import { sanitizeDockLayout } from "../../lib/dock-layout-sanitize";
import { canStep, EMPTY_NAV_HISTORY, readNavHistory, recordVisit, saveNavHistory, stepHistory, type NavHistory } from "../../lib/nav-history";
import { getPanelDefinition, instancePanelId, isPanelAvailable, panelInstanceId, panelRegistry, panelSupportsSurface, visiblePanels, type PanelDefinition } from "../../lib/panel-registry";
import { buildPanelComponents } from "../../lib/panel-components";
import {
  moveToPrimaryDock,
  moveToSecondaryDock,
  registerSecondaryDockMove,
  useSecondaryDock
} from "../../lib/secondary-dock";
import { detachSecondaryDockToWindow, useSecondaryDockHost } from "../../lib/secondary-dock-window";
import { GlobalShortcutDispatcher, ShortcutsProvider, useShortcutHandler } from "../../lib/shortcuts/registry";
import { DEFAULT_PLACE_GROUP, placeKey } from "../../lib/extensions/places";
import { useEnabledPlaces } from "../../lib/extensions/places-host";
import { getActiveWorkspaceId, setActiveWorkspaceId, useActiveWorkspace } from "../../lib/use-active-workspace";
import { ExtensionSlot } from "../../lib/extensions/slot";
import { detachPanelToWindow, openWorkspaceInNewWindow } from "../../lib/panel-window";
import { useDesktopDueReminders } from "../../lib/use-desktop-due-reminders";
import { useUpdateNotifier } from "../../lib/use-update-notifier";
import { addFolder, deleteFolder, folderOf, groupOnto, moveFolder, moveToFolder, orderedIds, placeInFolder, renameFolder, reorderPanels, toggleFolder } from "../../lib/sidebar-folders";
import { NodeBadge } from "../../components/node-badge";
import { cancelPendingSwitch, confirmPendingSwitch, hasUnsavedDrafts, requestWorkspaceSwitch, usePendingSwitch } from "../../lib/unsaved-drafts";
import { newFolderId, useSidebarFolders } from "../../lib/use-sidebar-folders";
import { buildSwitcherGroups } from "../../lib/workspace-order";

// The context panel names the section of whichever dock panel is active (ADR-0014).
setSectionResolver((panelId) => {
  const definition = getPanelDefinition(panelId);
  return definition ? { panelId, moduleId: definition.moduleId ?? null, label: definition.label } : null;
});

const NO_DISABLED_MODULES: string[] = [];
const NO_PLUGIN_OVERRIDES: string[] = [];

/**
 * dockview-core's own `Direction` type isn't part of its public export
 * surface (only `positionToDirection`'s return value is), so this mirrors
 * it structurally rather than importing something that doesn't exist at
 * the package boundary — see `packages/ui/src/workbench.tsx`'s U06 comment.
 */
type PanelSplitPosition = { referenceGroup: DockviewGroupPanel; direction: "left" | "right" | "above" | "below" | "within" };

/**
 * Closes every open tab whose module is off — walking the dock's open panels
 * rather than the registry, so instanced tabs (`project:<id>`) are caught too
 * and not just the one tab per registry id.
 */
function closeDisabledPanels(api: DockviewApi, disabledModules: readonly string[], pluginOverrides: readonly string[]): void {
  for (const panel of [...api.panels]) {
    const definition = getPanelDefinition(panel.id);
    if (definition && !isPanelAvailable(definition, disabledModules, pluginOverrides)) panel.api.close();
  }
}

// Dockview hands every panel its full `IDockviewPanelProps`; registry
// components only declare the slice they use (`params.instanceId`, `api.setTitle`).
// Shared with the second dock (`secondary-dock.ts`) — see `panel-components.tsx`.
const panelComponents = buildPanelComponents();

function NextLink({ href, className, children }: { href: string; className?: string; children: ReactNode }): React.ReactElement {
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/**
 * "Открепить в окне" — only rendered inside the Tauri desktop shell.
 * dockview's built-in popout is window.open()-based, which in Tauri v2
 * opens the system browser instead of a native window (no hook to
 * override it — see ORION v0.5 plan), so the desktop case is handled by
 * hand: open a real WebviewWindow on /panel/[id] and close the panel here
 * so it isn't shown twice. In the browser this button doesn't render at
 * all — dockview's own popout (a right-click / group menu action) already
 * does the right thing there via a real browser window.
 */
function DetachHeaderAction({ activePanel }: IDockviewHeaderActionsProps): React.ReactElement | null {
  const { toast } = useToast();
  if (!isTauri() || !activePanel || !panelSupportsSurface(activePanel.id, "window")) return null;

  async function detach(): Promise<void> {
    const panel = activePanel;
    if (!panel) return;
    if (hasUnsavedDrafts(panel.id)) {
      toast({ title: "Сначала сохраните изменения", description: "Открытый черновик нельзя перенести в новое окно.", tone: "default" });
      return;
    }
    const definition = getPanelDefinition(panel.id);
    await detachPanelToWindow(panel.id, panel.title ?? definition?.label ?? panel.id);
    panel.api.close();
  }

  return (
    <button
      type="button"
      onClick={detach}
      title="Открепить в окне"
      className="mr-2 rounded px-2 text-xs text-subtle-foreground hover:bg-white/10 hover:text-foreground"
    >
      ⧉
    </button>
  );
}

/** ORION-11: send the active tab to the second dock. Close-here/open-there, so nothing duplicates. */
function MoveToSecondaryHeaderAction({ activePanel }: IDockviewHeaderActionsProps): React.ReactElement | null {
  if (!activePanel) return null;
  return (
    <button
      type="button"
      onClick={() => moveToSecondaryDock(activePanel.id)}
      title="Переместить во второй сайдбар"
      aria-label="Переместить во второй сайдбар"
      className="mr-2 rounded px-2 text-xs text-subtle-foreground hover:bg-white/10 hover:text-foreground"
    >
      ⇥
    </button>
  );
}

/** The second dock's mirror of the action above — sends the active tab back to the main Workbench. */
function MoveToPrimaryHeaderAction({ activePanel }: IDockviewHeaderActionsProps): React.ReactElement | null {
  if (!activePanel) return null;
  return (
    <button
      type="button"
      onClick={() => moveToPrimaryDock(activePanel.id)}
      title="Переместить в основной сайдбар"
      aria-label="Переместить в основной сайдбар"
      className="mr-2 rounded px-2 text-xs text-subtle-foreground hover:bg-white/10 hover:text-foreground"
    >
      ⇤
    </button>
  );
}

/**
 * Floating mode: lift the active group above the workbench as a movable, resizable window
 * (and put it back). Works in the browser and in Tauri alike, unlike an OS window; the
 * panel and its data are untouched — only where it is drawn changes.
 */
function FloatHeaderAction({ containerApi, api, activePanel }: IDockviewHeaderActionsProps): React.ReactElement | null {
  // The location changes without this header re-rendering on its own: follow it.
  const [floating, setFloating] = useState(api.location.type === "floating");
  useEffect(() => {
    setFloating(api.location.type === "floating");
    const subscription = api.onDidLocationChange(() => setFloating(api.location.type === "floating"));
    return () => subscription.dispose();
  }, [api]);
  if (!activePanel || (!floating && !panelSupportsSurface(activePanel.id, "floating"))) return null;
  function toggle(): void {
    try {
      if (floating) {
        api.moveTo({ position: "right" });
      } else if (activePanel) {
        // Only the active panel leaves the dock: the other tabs stay where they were.
        const width = Math.min(720, Math.round(window.innerWidth * 0.5));
        const height = Math.min(560, Math.round(window.innerHeight * 0.7));
        containerApi.addFloatingGroup(activePanel, { x: 80, y: 80, width, height });
      }
    } catch {
      /* the layout refused the move: leave it where it is */
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      title={floating ? "Вернуть в рабочую область" : "Сделать плавающим окном"}
      aria-label={floating ? "Вернуть в рабочую область" : "Сделать плавающим окном"}
      className="mr-1 rounded px-2 text-xs text-subtle-foreground hover:bg-white/10 hover:text-foreground"
    >
      {floating ? "⇲" : "⇱"}
    </button>
  );
}

/**
 * Top-right of the panel group tab strip — the one persistent "top of the
 * app" spot regardless of which panel is active. Settings lives here instead
 * of the sidebar link list: it's account/workspace config, not a domain you
 * switch into during work, so it shouldn't compete with Tasks/Notes/etc. for
 * a nav slot (see panel-registry.ts `hideFromNav`).
 */
function HeaderActions(props: IDockviewHeaderActionsProps): React.ReactElement | null {
  const compact = useMediaQuery("(max-width: 767px)");
  const [moduleSettingsFor, setModuleSettingsFor] = useState<string | null>(null);
  // Precision shows the agents' pill in its own header; the legacy shell has only this strip.
  const { data: preferences } = usePreferences();
  const precision = preferences?.theme === "kaiden-precision";
  if (compact) return null;
  const activeId = props.activePanel?.id;
  return (
    <div className="flex items-center gap-1 overflow-visible">
      {activeId && activeId !== "settings" ? (
        <button
          type="button"
          onClick={() => setModuleSettingsFor(activeId)}
          title="Настройки модуля: внешний вид и плагины"
          aria-label="Настройки модуля"
          className="flex h-6 w-6 items-center justify-center rounded text-subtle-foreground hover:bg-white/10 hover:text-foreground"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <ModuleSettingsSheet
        panelId={moduleSettingsFor}
        open={moduleSettingsFor !== null}
        onClose={() => setModuleSettingsFor(null)}
        onOpenAppearance={() => {
          setModuleSettingsFor(null);
          openSettings("appearance");
        }}
      />
      <ResourcesToggle />
      <FloatHeaderAction {...props} />
      <MoveToSecondaryHeaderAction {...props} />
      <DetachHeaderAction {...props} />
      {precision ? null : <AgentPresencePill />}
      <RunningTimerChip />
      <NotificationBell size="sm" />
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }): React.ReactElement {
  const router = useRouter();
  useTaskProjectRouting();
  const { toast } = useToast();
  const { user, isLoading, status, previousUser, retry: retrySession } = useSession();
  const navigationToast = useRef(toast);
  navigationToast.current = toast;
  const logout = useLogout();
  const { play } = useUiSound();
  // ORION-07, root fallback: right-clicking anywhere that didn't claim its own menu (empty dock
  // space, a panel with no context items yet) gets Orion's own generic menu instead of the WebView's
  // — never the browser "Назад/Обновить/Печать" menu, and never literally nothing either.
  const rootContextMenu = useContextMenu(
    useCallback(
      (): (MenuItem | "separator")[] => [
        { label: "Команды… (Ctrl+K)", icon: Search, onSelect: () => window.dispatchEvent(new CustomEvent("orion:open-command-palette")) }
      ],
      []
    )
  );
  // A window opened with `?workspaceId=` starts on that workspace. Only when this window has no
  // choice of its own yet (a reload keeps its own), and before the "no workspace → /spaces"
  // redirect below can fire.
  useEffect(() => {
    if (getActiveWorkspaceId()) return;
    const seed = new URLSearchParams(window.location.search).get("workspaceId");
    if (seed) setActiveWorkspaceId(seed);
  }, []);
  const { workspace, workspaces, isLoading: workspacesLoading } = useActiveWorkspace();
  // U05 (24-CONNECTED-CORE-BACKLOG.md) — the sidebar switcher groups the
  // `<select>` by the user's own spheres via `<optgroup>` (native, keyboard-
  // and screen-reader-friendly, no new UI primitive needed). Personal
  // metadata only — never affects `workspaces` itself or who can see them.
  const { data: organization } = useWorkspaceOrganization();
  const switcherGroups = useMemo(() => buildSwitcherGroups(workspaces, organization), [workspaces, organization]);
  // Disabled for everyone, plus restricted-to-owner/lead modules when the
  // viewer is a plain member — see `effectiveDisabledModules`.
  const disabledModules = workspace ? effectiveDisabledModules(workspace) : NO_DISABLED_MODULES;
  const { data: preferences } = usePreferences();
  const precision = preferences?.theme === "kaiden-precision";
  const shortcutOverrides = useMemo(() => (preferences?.shortcutOverrides ?? {}) as Record<string, string>, [preferences?.shortcutOverrides]);
  const [contextHidden, setContextHidden] = useState(false);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const wideInspector = useMediaQuery("(min-width: 1360px)");
  // Panels that enabled plugins and extensions ADD (ADR-0022): `ext:<pluginId>.<id>` entries in the same list, so folders,
  // ordering, "open beside" and "new window" treat them like any other section.
  const extensionPanels = useEnabledPlaces("panel");
  const extensionNav = extensionPanels.flatMap((place): PanelDefinition[] => {
    const id = instancePanelId("ext", placeKey(place));
    const host = getPanelDefinition(id);
    return host ? [{ ...host, id, label: place.label, icon: place.icon, group: place.group ?? DEFAULT_PLACE_GROUP, hideFromNav: false }] : [];
  });
  const navPanels = [...visiblePanels(disabledModules, preferences?.hiddenModules, workspace?.pluginOverrides), ...extensionNav];

  // The user's own sidebar folders: personal, saved with their preferences.
  const { folders: sidebarFolders, save: saveFolders, order: sidebarOrder, saveOrder } = useSidebarFolders();
  const sidebarPosition = preferences?.sidebarPosition ?? "left";
  const pendingSwitch = usePendingSwitch();
  const [pendingExit, setPendingExit] = useState<"spaces" | "logout" | null>(null);
  const [pendingTabClose, setPendingTabClose] = useState<string | null>(null);
  const leaveWorkbench = useCallback((destination: "spaces" | "logout") => {
    if (hasUnsavedDrafts()) {
      setPendingExit(destination);
      return;
    }
    if (destination === "logout") {
      play("auth.logout");
      logout.mutate(undefined, { onSuccess: () => router.replace("/login") });
    } else router.push("/spaces");
  }, [logout, play, router]);
  const defaultNavIds = navPanels.map((panel) => panel.id);
  const orderedNav = orderedIds(defaultNavIds, sidebarOrder).map((id) => navPanels.find((panel) => panel.id === id)!);
  const [folderDialog, setFolderDialog] = useState<{ mode: "create"; panelId?: string } | { mode: "rename"; id: string; name: string } | null>(null);
  const folderViews = useMemo<SidebarFolderView[]>(() => {
    const visible = new Set(navPanels.map((panel) => panel.id));
    return sidebarFolders.map((folder, index) => ({
      id: folder.id,
      name: folder.name,
      collapsed: folder.collapsed,
      // A hidden or switched-off module stays recorded in the folder, it just isn't drawn.
      linkIds: folder.items.filter((id) => visible.has(id)),
      menuItems: [
        { label: "Переименовать…", onSelect: () => setFolderDialog({ mode: "rename", id: folder.id, name: folder.name }) },
        { label: "Выше", disabled: index === 0, onSelect: () => saveFolders(moveFolder(sidebarFolders, folder.id, -1)) },
        { label: "Ниже", disabled: index === sidebarFolders.length - 1, onSelect: () => saveFolders(moveFolder(sidebarFolders, folder.id, 1)) },
        "separator",
        { label: "Удалить папку", tone: "danger", onSelect: () => saveFolders(deleteFolder(sidebarFolders, folder.id)) }
      ] satisfies (MenuItem | "separator")[]
    }));
    // navPanels is rebuilt every render; its ids are what matter, so key the memo on them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarFolders, navPanels.map((panel) => panel.id).join("|"), saveFolders]);
  const { data: tasks } = useTasks(isModuleEnabled(disabledModules, "tasks") ? workspace?.id : undefined);
  const { data: inboxQueue } = useInbox(workspace?.id, false);
  useDesktopDueReminders(tasks);
  useUpdateNotifier();

  const apiRef = useRef<DockviewApi | null>(null);

  // ORION-11: a second, independent dock — own DockviewApi, own saved layout, can be
  // detached into its own window on another monitor. See `secondary-dock.ts`.
  const secondaryDock = useSecondaryDock();
  const { requestRedock } = useSecondaryDockHost();
  const secondaryApiRef = useRef<DockviewApi | null>(null);
  const secondaryKey = user && workspace ? dockLayoutStorageKey(user.id, workspace.id, "secondary") : null;
  const openInSecondaryDock = useCallback(
    (panelId: string, title?: string) => {
      const api = secondaryApiRef.current;
      const definition = getPanelDefinition(panelId);
      if (!api || !definition || !isPanelAvailable(definition, disabledModulesRef.current, pluginOverridesRef.current)) return;
      const existing = api.getPanel(panelId);
      if (existing) {
        existing.api.setActive();
        return;
      }
      const instanceId = panelInstanceId(panelId);
      api.addPanel({ id: panelId, component: definition.id, title: title ?? definition.label, ...(instanceId ? { params: { instanceId } } : {}) });
      secondaryDock.setOpen(true);
    },
    [secondaryDock]
  );
  const onSecondaryReady = useCallback(
    (event: DockviewReadyEvent) => {
      secondaryApiRef.current = event.api;
      if (!secondaryKey) return;
      try {
        const raw = window.localStorage.getItem(secondaryKey);
        const clean = raw ? sanitizeDockLayout(JSON.parse(raw), (id) => Boolean(getPanelDefinition(id)), { width: window.innerWidth, height: window.innerHeight }) : null;
        if (clean) event.api.fromJSON(clean.layout as unknown as Parameters<DockviewApi["fromJSON"]>[0]);
      } catch {
        /* a corrupt saved layout just starts this dock empty */
      }
      event.api.onDidLayoutChange(() => {
        try {
          window.localStorage.setItem(secondaryKey, JSON.stringify(event.api.toJSON()));
        } catch {
          /* a lost save just means the next change tries again */
        }
      });
    },
    [secondaryKey]
  );
  /** "Переместить во второй сайдбар": close here, open there with the same id/params — never duplicates the underlying record. */
  const moveOpenPanelToSecondary = useCallback(
    (panelId: string) => {
      const panel = apiRef.current?.getPanel(panelId);
      const title = panel?.title ?? getPanelDefinition(panelId)?.label;
      panel?.api.close();
      openInSecondaryDock(panelId, title);
    },
    [openInSecondaryDock]
  );

  // Named layouts ("Разработка", "Финансы"): a saved set of open panels, per user and workspace.
  const [layoutDialogOpen, setLayoutDialogOpen] = useState(false);
  const [layoutNames, setLayoutNames] = useState<string[]>([]);
  const namedKey = user && workspace ? namedLayoutsKey(user.id, workspace.id) : null;
  const saveLayoutAs = useCallback(
    (name: string) => {
      const api = apiRef.current;
      if (!api || !namedKey) return;
      try {
        if (saveNamedLayout(window.localStorage, namedKey, name, api.toJSON())) {
          setLayoutNames(listNamedLayouts(window.localStorage, namedKey));
        }
      } catch {
        /* storage blocked: the layout simply is not saved */
      }
    },
    [namedKey]
  );
  /**
   * Puts a saved layout into the dock: panels that no longer exist are pruned out of it first,
   * then the ones whose module/plugin is off are closed. `false` = nothing usable to apply
   * (missing, corrupt, or empty after pruning) and the dock is left as it was.
   */
  const applyNamedToApi = useCallback((api: DockviewApi, key: string, name: string): boolean => {
    try {
      const saved = getNamedLayout(window.localStorage, key, name);
      const pruned = pruneDockLayout(saved, (component) => getPanelDefinition(component) !== undefined);
      if (!pruned) return false;
      api.fromJSON(pruned as unknown as Parameters<DockviewApi["fromJSON"]>[0]);
      closeDisabledPanels(api, disabledModulesRef.current, pluginOverridesRef.current);
      return true;
    } catch {
      /* an incompatible layout leaves the current one in place */
      return false;
    }
  }, []);
  const applyLayout = useCallback(
    (name: string) => {
      const api = apiRef.current;
      if (!api || !namedKey) return;
      applyNamedToApi(api, namedKey, name);
    },
    [namedKey, applyNamedToApi]
  );
  const [layoutDefault, setLayoutDefault] = useState<string | null>(null);
  const [layoutsManagerOpen, setLayoutsManagerOpen] = useState(false);
  const refreshLayouts = useCallback(() => {
    try {
      setLayoutNames(namedKey ? listNamedLayouts(window.localStorage, namedKey) : []);
      setLayoutDefault(namedKey ? getDefaultLayoutName(window.localStorage, namedKey) : null);
    } catch {
      setLayoutNames([]);
      setLayoutDefault(null);
    }
  }, [namedKey]);
  useEffect(() => {
    refreshLayouts();
  }, [refreshLayouts]);
  const removeLayout = useCallback(
    (name: string) => {
      if (!namedKey) return;
      try {
        deleteNamedLayout(window.localStorage, namedKey, name);
      } catch {
        /* ignore */
      }
      refreshLayouts();
    },
    [namedKey, refreshLayouts]
  );
  const markDefaultLayout = useCallback(
    (name: string | null) => {
      if (!namedKey) return;
      setDefaultLayoutName(window.localStorage, namedKey, name);
      refreshLayouts();
    },
    [namedKey, refreshLayouts]
  );
  const renameLayout = useCallback(
    (from: string, to: string): boolean => {
      if (!namedKey) return false;
      const ok = renameNamedLayout(window.localStorage, namedKey, from, to);
      refreshLayouts();
      return ok;
    },
    [namedKey, refreshLayouts]
  );
  const exportLayouts = useCallback(() => (namedKey ? exportNamedLayouts(window.localStorage, namedKey) : ""), [namedKey]);
  const importLayouts = useCallback(
    (text: string) => {
      if (!namedKey) return { ok: false, error: "Нет активного пространства.", added: 0, replaced: 0, skipped: 0 };
      const result = importNamedLayouts(window.localStorage, namedKey, text);
      refreshLayouts();
      return result;
    },
    [namedKey, refreshLayouts]
  );
  // Named layouts - integrate with shortcut system (Alt+1..9)
  const layoutNamesRef = useRef(layoutNames);
  layoutNamesRef.current = layoutNames;
  
  // Track current index for Alt+N shortcuts
  const [activeLayoutIndex, setActiveLayoutIndex] = useState(0);
  
  useShortcutHandler("global.layout-1", () => { const name = layoutNamesRef.current[0]; if (name) applyLayout(name); });
  useShortcutHandler("global.layout-2", () => { const name = layoutNamesRef.current[1]; if (name) applyLayout(name); });
  useShortcutHandler("global.layout-3", () => { const name = layoutNamesRef.current[2]; if (name) applyLayout(name); });
  useShortcutHandler("global.layout-4", () => { const name = layoutNamesRef.current[3]; if (name) applyLayout(name); });
  useShortcutHandler("global.layout-5", () => { const name = layoutNamesRef.current[4]; if (name) applyLayout(name); });
  useShortcutHandler("global.layout-6", () => { const name = layoutNamesRef.current[5]; if (name) applyLayout(name); });
  useShortcutHandler("global.layout-7", () => { const name = layoutNamesRef.current[6]; if (name) applyLayout(name); });
  useShortcutHandler("global.layout-8", () => { const name = layoutNamesRef.current[7]; if (name) applyLayout(name); });
  useShortcutHandler("global.layout-9", () => { const name = layoutNamesRef.current[8]; if (name) applyLayout(name); });
  
  // Remove the old direct keyboard listener below
  
  const closeTab = useCallback((panelId: string) => {
    if (hasUnsavedDrafts(panelId)) {
      setPendingTabClose(panelId);
      return;
    }
    apiRef.current?.getPanel(panelId)?.api.close();
  }, []);
  const disabledModulesRef = useRef(disabledModules);
  disabledModulesRef.current = disabledModules;
  const pluginOverrides = workspace?.pluginOverrides ?? NO_PLUGIN_OVERRIDES;
  const pluginOverridesRef = useRef(pluginOverrides);
  pluginOverridesRef.current = pluginOverrides;
  const compact = useMediaQuery("(max-width: 767px)");
  const compactRef = useRef(compact);
  compactRef.current = compact;
  const openTabsModeRef = useRef<"accumulate" | "replace">("accumulate");
  openTabsModeRef.current = preferences?.openTabsMode ?? "accumulate";
  // U04: which `dockLayoutStorageKey` the currently-loaded layout came from,
  // so the workspace-switch effect below can tell "this is the very first
  // load" (null) apart from "the user just switched workspace in this same
  // window" (a real previous key to save under before loading the new one).
  const layoutKeyRef = useRef<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  // Back/forward over the panels (objects and views) this window has shown; per workspace, kept in localStorage so a reload keeps it.
  const [navHistory, setNavHistory] = useState<NavHistory>(EMPTY_NAV_HISTORY);
  const navHistoryRef = useRef(navHistory);
  navHistoryRef.current = navHistory;
  useEffect(() => {
    if (activePanelId) setNavHistory(history => recordVisit(history, activePanelId));
  }, [activePanelId]);
  // The workspace the history in state belongs to: loaded on first sight of a workspace (also replaces the old one on a
  // switch), and only then written back, so one workspace's list is never saved under another's key.
  const navWorkspaceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!workspace?.id || navWorkspaceRef.current === workspace.id) return;
    navWorkspaceRef.current = workspace.id;
    setNavHistory(readNavHistory(window.localStorage, workspace.id, id => Boolean(getPanelDefinition(id))));
  }, [workspace?.id]);
  const navPersistReadyRef = useRef(false);
  useEffect(() => {
    // The mount run still sees the empty initial state and would wipe what is stored.
    if (!navPersistReadyRef.current) {
      navPersistReadyRef.current = true;
      return;
    }
    if (navWorkspaceRef.current) saveNavHistory(window.localStorage, navWorkspaceRef.current, navHistory);
  }, [navHistory]);
  // A project tab (`project:<id>`) keeps "Проекты" lit in the sidebar.
  const activeDefinition = activePanelId ? getPanelDefinition(activePanelId) : undefined;
  // An extension panel is its own menu item (`ext:<key>`), not the shared host kind.
  const activeNavId = activeDefinition?.id === "ext" ? activePanelId : activeDefinition?.navParent ?? activeDefinition?.id;
  const objectContext = useObjectContext(workspace?.id, activePanelId);
  const editorContext = objectContext && ["task", "note", "document"].includes(objectContext.entityType) ? objectContext : null;
  const activeProjectId = activeDefinition?.navParent === "projects" ? projectContextId(activePanelId) : undefined;
  // The assistant hears what was on screen before it («эта задача»): the last non-assistant panel and its open record.
  useEffect(() => {
    if (!activePanelId) return;
    rememberAssistantView({
      panel: activePanelId,
      label: activeDefinition?.label ?? activePanelId,
      entityType: objectContext?.entityType ?? (activeProjectId ? "project" : null),
      entityId: objectContext?.entityId ?? activeProjectId ?? null,
      title: objectContext?.title ?? null
    });
  }, [activePanelId, activeDefinition?.label, objectContext?.entityType, objectContext?.entityId, objectContext?.title, activeProjectId]);
  useEffect(() => { setInspectorOpen(false); setMobileContextOpen(false); }, [workspace?.id]);
  useEscapeKey(() => setDrawerOpen(false), compact && drawerOpen);

  // Real total (S15), not `items.length` — the server caps the response at 250 rows.
  const inboxCount = inboxQueue?.totalCount ?? 0;
  // `localNow` only changes at a real local-day boundary or a visibility/focus
  // wake (S10, see use-day-boundary.ts) — without it in the deps, a sidebar
  // left open past midnight (or a laptop that slept through the night) kept
  // showing yesterday's overdue count until something unrelated re-rendered.
  const localNow = useLocalNow();
  const overdueCount = useMemo(
    () =>
      (tasks ?? []).filter(
        (t) => !isTaskClosed(t.status) && t.dueAt && new Date(t.dueAt).getTime() < localNow.getTime()
      ).length,
    [tasks, localNow]
  );

  // Stable across renders (empty deps) so registerPanelBus/drag-drop/menu
  // handlers below always read the *current* apiRef, not a stale one.
  // `position` is how U06's drag-drop and "split" menu command reach a
  // specific dock location; a plain click (`openPanel`) omits it and gets
  // dockview's own default placement, same as before U06. Duplicate/focus
  // policy lives here once, for every caller: an already-open panel is
  // always just focused, never duplicated or moved — see `panel-drop.ts`'s
  // `resolveDropAction` doc for why the drop path doesn't try to relocate
  // an existing tab either.
  const placePanel = useCallback(
    (panelId: string, position?: PanelSplitPosition, title?: string, fromMenu = false) => {
      const api = apiRef.current;
      if (!api) return;
      const previous = api.activePanel;
      // Compact navigation and replace-current mode close panels. Never bypass their draft guards.
      const closing = compactRef.current ? api.panels.filter(panel => panel.id !== panelId)
        : openTabsModeRef.current === "replace" && fromMenu && !position && previous?.id !== panelId && previous ? [previous] : [];
      if (closing.some(panel => hasUnsavedDrafts(panel.id))) {
        navigationToast.current({ title: "Сначала сохраните изменения", description: "Переход закроет панель с несохранённым черновиком. Сохраните его и повторите переход." });
        return;
      }
      const existing = api.getPanel(panelId);
      if (existing) {
        existing.api.setActive();
      } else {
        const definition = getPanelDefinition(panelId);
        if (!definition) return;
        if (!isPanelAvailable(definition, disabledModulesRef.current, pluginOverridesRef.current)) return;
        // Instanced panels (`project:<id>`) share one component; the record id
        // travels in `params` and is persisted by dockview's own toJSON.
        const instanceId = panelInstanceId(panelId);
        api.addPanel({
          id: panelId,
          component: definition.id,
          title: title ?? definition.label,
          ...(instanceId ? { params: { instanceId } } : {}),
          ...(position ? { position } : {})
        });
      }
      if (compactRef.current) {
        for (const panel of api.panels) {
          if (panel.id !== panelId) panel.api.close();
        }
        setDrawerOpen(false);
      } else if (openTabsModeRef.current === "replace" && fromMenu && !position && previous && previous.id !== panelId) {
        // «Заменять текущую»: the section takes the place of the tab you were on instead of adding one.
        previous.api.close();
      }
    },
    []
  );

  const openPanel = useCallback((panelId: string, title?: string) => placePanel(panelId, undefined, title), [placePanel]);
  // A click in the menu is the only open that may replace the current tab («Заменять текущую»);
  // moving between panels from inside a panel (open a project from the list) always adds a tab.
  const openFromMenu = useCallback((panelId: string) => placePanel(panelId, undefined, undefined, true), [placePanel]);
  /** "Переместить в основной сайдбар": close here, reopen there with the same id/params — never duplicates the record. */
  const moveOpenPanelToPrimary = useCallback(
    (panelId: string) => {
      const panel = secondaryApiRef.current?.getPanel(panelId);
      const title = panel?.title;
      panel?.api.close();
      placePanel(panelId, undefined, title);
    },
    [placePanel]
  );
  useEffect(
    () => registerSecondaryDockMove({ toSecondary: moveOpenPanelToSecondary, toPrimary: moveOpenPanelToPrimary }),
    [moveOpenPanelToSecondary, moveOpenPanelToPrimary]
  );

  /**
   * Non-drag alternative to "drop on an edge" (U06 done-criterion:
   * "альтернативы меню/клавиатурой") — splits next to whichever group is
   * currently active. No active group (empty dock) falls back to the
   * ordinary open, same as a click.
   */
  const openPanelSplit = useCallback(
    (panelId: string) => {
      const api = apiRef.current;
      const referenceGroup = api?.activeGroup;
      placePanel(panelId, referenceGroup ? { referenceGroup, direction: "right" } : undefined);
    },
    [placePanel]
  );

  /**
   * U04: loads the saved layout for `key` into `api` (or falls back to just
   * the dashboard panel), then re-applies the disabled-modules/compact
   * pruning that used to only run once inside `onReady`. Shared between the
   * initial mount (`onReady`) and the workspace-switch effect below — a
   * switch must go through exactly the same "close what's not allowed here"
   * logic as a fresh load, not a hand-rolled subset of it.
   */
  const loadLayoutForKey = useCallback(
    (api: DockviewApi, key: string, namedKey: string) => {
      let restored = false;
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          // Unknown panels are dropped and floating groups pulled back on screen, instead of one bad
          // tab discarding the whole saved layout.
          const clean = sanitizeDockLayout(JSON.parse(raw), (id) => getPanelDefinition(id) !== undefined, { width: window.innerWidth, height: window.innerHeight });
          if (clean) {
            api.fromJSON(clean.layout as unknown as Parameters<DockviewApi["fromJSON"]>[0]);
            restored = true;
            if (clean.removedPanels.length > 0 || clean.movedFloating > 0) {
              navigationToast.current({ title: "Рабочее место восстановлено частично", description: "Часть вкладок больше недоступна или окна возвращены в границы экрана." });
            }
          }
        }
      } catch {
        // corrupt or incompatible saved layout (e.g. a removed panel id) — fall through to the default
      }
      if (!restored) {
        // No automatic layout yet: the workspace's «открывать при входе» layout, if one is marked.
        try {
          const preferred = getDefaultLayoutName(window.localStorage, namedKey);
          if (preferred) restored = applyNamedToApi(api, namedKey, preferred);
        } catch {
          /* fall through to the dashboard */
        }
      }
      if (!restored) {
        openPanel("dashboard");
      } else {
        closeDisabledPanels(api, disabledModulesRef.current, pluginOverridesRef.current);
        if (compactRef.current) {
          const keep = api.activePanel?.id ?? "dashboard";
          for (const panel of api.panels) {
            if (panel.id !== keep) panel.api.close();
          }
        }
      }
    },
    [openPanel, applyNamedToApi]
  );

  useEffect(() => registerPanelBus({ openPanel, openObject: (view, mode, title) => {
        const panelId = objectViewPanel(view, getActiveWorkspaceId());
        const definition = panelId ? getPanelDefinition(panelId) : undefined;
        if (!panelId || !definition || !isPanelAvailable(definition, disabledModulesRef.current, pluginOverridesRef.current)
          || (definition.id === "projecttasks" && !isModuleEnabled(disabledModulesRef.current, "tasks"))) {
          navigationToast.current({ title: "Представление недоступно", description: "Проверьте текущее пространство и включённые модули." });
          return;
        }
        if (mode === "window" && panelSupportsSurface(panelId, "window")) {
          void detachPanelToWindow(panelId, title ?? definition.label).catch(() => navigationToast.current({ title: "Не удалось открыть окно" }));
        } else {
          const referenceGroup = apiRef.current?.activeGroup;
          placePanel(panelId, mode === "beside" && !compactRef.current && referenceGroup ? { referenceGroup, direction: "right" } : undefined, title);
        }
      } }), [openPanel, placePanel]);

  const canShowPanel = useCallback((panelId: string): boolean => {
    const definition = getPanelDefinition(panelId);
    return Boolean(definition) && isPanelAvailable(definition!, disabledModulesRef.current, pluginOverridesRef.current)
      && !(definition!.id === "projecttasks" && !isModuleEnabled(disabledModulesRef.current, "tasks"));
  }, []);
  const goHistory = useCallback((direction: -1 | 1) => {
    const before = navHistoryRef.current;
    const step = stepHistory(before, direction, canShowPanel);
    if (!step) return;
    setNavHistory(step.history);
    placePanel(step.target);
    // A draft guard (or a failed open) leaves the old panel active: keep the history where it was.
    if (apiRef.current?.activePanel?.id !== step.target) setNavHistory(before);
  }, [placePanel, canShowPanel]);
  const goHistoryRef = useRef(goHistory);
  goHistoryRef.current = goHistory;
  
  // History back/forward - integrate with shortcut system
  useShortcutHandler("global.history-back", () => goHistory(-1));
  useShortcutHandler("global.history-forward", () => goHistory(1));
  
  // Remove the old direct keyboard listener below
  
  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;
      api.onDidActivePanelChange((panel) => {
        setActivePanelId(panel?.id ?? null);
        resourceContextActions.setActivePanel(panel?.id ?? null);
      });

      // U06 (24-CONNECTED-CORE-BACKLOG.md) — sidebar drag→Dockview. This
      // rides entirely on dockview-core's own external-drag machinery
      // (visible drop-zone overlays included) instead of a hand-rolled
      // HTML5 DnD implementation:
      //   - `onWillShowOverlay` fires per-group while hovering; dockview
      //     shows its built-in center/edge overlay unless we call
      //     `preventDefault()`. Reject it for anything that isn't ORION's
      //     own sidebar drag (`getData()` is how dockview's OWN internal
      //     tab-reorder drags are told apart — those must be left alone).
      //   - `onUnhandledDragOverEvent` is the same decision for the empty
      //     grid area outside any group (e.g. an empty dock) — must call
      //     `.accept()` explicitly or nothing is droppable there at all.
      //   - `onDidDrop` fires once, on the actual drop, with the resolved
      //     `group`/`position` — `dataTransfer.getData()` is only reliably
      //     readable here (not during dragover), see `panel-drop.ts`.
      // Escape-to-cancel and "drop outside any valid zone does nothing" are
      // both native HTML5 drag-and-drop behaviour, not something ORION
      // needs to implement — a rejected/incomplete drag never fires
      // `onDidDrop` at all.
      api.onWillShowOverlay((willShow: DockviewWillShowOverlayLocationEvent) => {
        if (!willShow.getData() && !isOrionPanelDragEvent(willShow.nativeEvent)) {
          willShow.preventDefault();
        }
      });
      api.onUnhandledDragOverEvent((overlay: DockviewDndOverlayEvent) => {
        if (isOrionPanelDragEvent(overlay.nativeEvent)) overlay.accept();
      });
      api.onDidDrop((drop: DockviewDidDropEvent) => {
        if (drop.getData()) return; // dockview's own internal panel/tab drag — not ours to handle
        const panelId = readDraggedPanelId(drop.nativeEvent);
        // Plain ids and instance ids (`browsertab:<id>`) both resolve through the registry.
        const definition = panelId ? getPanelDefinition(panelId) : undefined;
        const known = new Set(definition && panelId ? [panelId] : []);
        const disabledIds = new Set(
          definition && panelId && !isPanelAvailable(definition, disabledModulesRef.current, pluginOverridesRef.current) ? [panelId] : []
        );
        const openIds = new Set(api.panels.map((p) => p.id));
        const action = resolveDropAction(panelId, known, disabledIds, openIds);
        if (action.kind === "unknown-panel" || action.kind === "module-disabled" || !panelId) return;
        if (action.kind === "focus") {
          api.getPanel(panelId)?.api.setActive();
          return;
        }
        const group = drop.group;
        placePanel(panelId, group ? { referenceGroup: group, direction: positionToDirection(drop.position) } : undefined);
      });

      // The render gate below (`if (isLoading || !user || workspacesLoading
      // || !workspace) return <spinner>`) means Workbench — and therefore
      // this onReady callback — only ever mounts once both are loaded.
      const key = dockLayoutStorageKey(user!.id, workspace!.id);
      layoutKeyRef.current = key;
      loadLayoutForKey(api, key, namedLayoutsKey(user!.id, workspace!.id));

      let saveTimer: ReturnType<typeof setTimeout> | undefined;
      api.onDidLayoutChange(() => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          const currentKey = layoutKeyRef.current;
          if (!currentKey) return;
          try {
            window.localStorage.setItem(currentKey, JSON.stringify(api.toJSON()));
          } catch {
            // best-effort only — a failed write just means layout won't persist this time
          }
        }, 300);
      });
    },
    [placePanel, loadLayoutForKey, user, workspace]
  );

  // U04: the sidebar's workspace `<select>` (and /spaces) switch the active
  // workspace WITHOUT unmounting Workbench — dockview keeps running with
  // whatever panels/positions the previous workspace had. Without this, a
  // switch would (a) silently keep showing the old workspace's layout as if
  // it belonged to the new one, and (b) any edit to it after the switch
  // would save OVER the old workspace's stored layout under the shared key
  // that used to exist. Flush the outgoing layout under its own key first,
  // then load (or default-init) the incoming workspace's own layout —
  // mirrors exactly what `onReady` does for the first load.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !user || !workspace) return;
    const nextKey = dockLayoutStorageKey(user.id, workspace.id);
    const previousKey = layoutKeyRef.current;
    if (previousKey === null || previousKey === nextKey) return;
    try {
      window.localStorage.setItem(previousKey, JSON.stringify(api.toJSON()));
    } catch {
      // best-effort — see the identical catch in onReady's save timer
    }
    for (const panel of [...api.panels]) panel.api.close();
    layoutKeyRef.current = nextKey;
    loadLayoutForKey(api, nextKey, namedLayoutsKey(user.id, workspace.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, workspace?.id]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    closeDisabledPanels(api, disabledModules, pluginOverrides);
  }, [disabledModules, pluginOverrides]);

  useEffect(() => {
    // Only a confirmed logged-out session sends the user to /login.
    // `status === "unavailable"` (network error, API down) must not — it
    // would discard whatever the user was doing over a blip that a retry
    // could recover from.
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    // Same stale-snapshot guard as the panel window: an id already stored for this window that
    // names one of the user's workspaces will be picked up on the next render — don't bounce to /spaces.
    const storedId = getActiveWorkspaceId();
    const storedIsKnown = storedId !== null && workspaces.some((item) => item.id === storedId);
    if (status === "authenticated" && !workspacesLoading && !workspace && !storedIsKnown) {
      router.replace("/spaces");
    }
  }, [status, workspacesLoading, workspace, workspaces, router]);

  const projectViews = [
    { id: "project", label: "Обзор" }, { id: "projecttasks", label: "Задачи" },
    { id: "projectmaterials", label: "Материалы" }, { id: "projectplan", label: "План" },
    { id: "projectaccess", label: "Доступ" }
  ].filter(view => {
    // Catalog lookup: getPanelDefinition deliberately rejects bare instanced kinds.
    const definition = panelRegistry.find(panel => panel.id === view.id);
    return definition && isPanelAvailable(definition, disabledModules, pluginOverrides)
      && (view.id !== "projecttasks" || isModuleEnabled(disabledModules, "tasks"));
  });
  const openContextProject = (panelId: string, title: string, mode: ProjectOpenMode): void => {
    const definition = getPanelDefinition(panelId);
    if (!definition || !isPanelAvailable(definition, disabledModules, pluginOverrides)) return;
    if (mode === "window" && panelSupportsSurface(panelId, "window")) {
      void detachPanelToWindow(panelId, title).catch(() => toast({ title: "Не удалось открыть окно", tone: "danger" }));
    } else if (mode === "beside" && !compact) {
      const referenceGroup = apiRef.current?.activeGroup;
      placePanel(panelId, referenceGroup ? { referenceGroup, direction: "right" } : undefined, title);
    } else if (definition.id === "project") {
      openEntity("project", panelInstanceId(panelId)!, title);
    } else openPanel(panelId, title);
    setMobileContextOpen(false);
  };

  if (status === "unavailable") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
        <p>
          Не удаётся связаться с сервером{previousUser ? ` (вы были в сети как ${previousUser.name})` : ""}. Проверьте
          соединение и попробуйте ещё раз — локальные данные никуда не делись.
        </p>
        <button
          type="button"
          onClick={retrySession}
          className="rounded-lg border border-border px-3 py-1.5 text-foreground hover:bg-white/5"
        >
          Повторить
        </button>
      </div>
    );
  }

  if (isLoading || !user || workspacesLoading || !workspace) {
    return <LoadingScreen />;
  }

  const secondaryDockColumn = secondaryDock.detachedElsewhere ? (
    <div
      className={cx(
        "flex w-10 shrink-0 flex-col items-center gap-2 border-border bg-background/60 py-2",
        secondaryDock.position === "left" ? "border-r" : "border-l"
      )}
    >
      <IconButton label="Второй сайдбар открыт в отдельном окне — вернуть сюда" onClick={requestRedock}>
        <Columns2 className="h-4 w-4" />
      </IconButton>
    </div>
  ) : (
    <div
      className="flex shrink-0 flex-col border-border"
      style={{ width: secondaryDock.width, borderLeftWidth: secondaryDock.position === "right" ? 1 : 0, borderRightWidth: secondaryDock.position === "left" ? 1 : 0 }}
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-1 border-b border-border px-2">
        <span className="truncate text-label text-subtle-foreground">Второй сайдбар</span>
        <div className="flex items-center gap-0.5">
          <IconButton
            label={secondaryDock.position === "left" ? "Перенести вправо" : "Перенести влево"}
            size="sm"
            onClick={() => secondaryDock.setPosition(secondaryDock.position === "left" ? "right" : "left")}
          >
            {secondaryDock.position === "left" ? <PanelRight className="h-3.5 w-3.5" /> : <PanelLeft className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton label="Открепить на другой экран" size="sm" onClick={() => void detachSecondaryDockToWindow(workspace.id)}>
            <span aria-hidden className="text-xs">⧉</span>
          </IconButton>
          <IconButton label="Закрыть второй сайдбар" size="sm" onClick={() => secondaryDock.setOpen(false)}>
            <span aria-hidden className="text-xs">✕</span>
          </IconButton>
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        <Workbench
          components={panelComponents}
          onReady={onSecondaryReady}
          onRequestClose={(panelId) => secondaryApiRef.current?.getPanel(panelId)?.api.close()}
          rightHeaderActionsComponent={MoveToPrimaryHeaderAction}
        />
      </div>
    </div>
  );

  return (
    <ShortcutsProvider overrides={shortcutOverrides}>
    <div
      className={cx(
        "flex h-dvh bg-background",
        precision && "orion-shell--precision",
        compact && "orion-shell--compact",
        // The phone always uses the left drawer; the menu's own edge applies to the desktop shell.
        !compact && sidebarPosition === "right" && "flex-row-reverse",
        !compact && sidebarPosition === "top" && "flex-col",
        !compact && sidebarPosition === "bottom" && "flex-col-reverse"
      )}
      onContextMenu={rootContextMenu.onContextMenu}
    >
      <GlobalShortcutDispatcher />
      <AppBackground />
      <FolderNameDialog
        open={layoutDialogOpen}
        title="Сохранить раскладку"
        initial=""
        submitLabel="Сохранить"
        placeholder="Например, «Разработка»"
        maxLength={LAYOUT_NAME_MAX}
        clean={cleanLayoutName}
        onClose={() => setLayoutDialogOpen(false)}
        onSubmit={(name) => {
          setLayoutDialogOpen(false);
          saveLayoutAs(name);
        }}
      />
      <LayoutsDialog
        open={layoutsManagerOpen}
        onClose={() => setLayoutsManagerOpen(false)}
        names={layoutNames}
        defaultName={layoutDefault}
        onSetDefault={markDefaultLayout}
        onRename={renameLayout}
        onDelete={removeLayout}
        onExport={exportLayouts}
        onImport={importLayouts}
      />
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
          const next =
            dialog.mode === "rename"
              ? renameFolder(sidebarFolders, dialog.id, name)
              : addFolder(sidebarFolders, name, newFolderId(), dialog.panelId);
          if (next) saveFolders(next);
        }}
      />
      {compact && drawerOpen ? (
        <button
          type="button"
          aria-label="Закрыть меню"
          className="fixed inset-0 z-30 bg-black/50"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}
      <Sidebar
        allIconsVisible={precision}
        folders={folderViews}
        onToggleFolder={(id) => saveFolders(toggleFolder(sidebarFolders, id))}
        onCreateFolder={(panelId) => setFolderDialog({ mode: "create", panelId })}
        onMoveLink={(panelId, folderId, beforeId) => {
          const nextFolders = placeInFolder(sidebarFolders, panelId, folderId, beforeId);
          if (nextFolders.some((folder, index) => folder.items.join() !== sidebarFolders[index]?.items.join())) saveFolders(nextFolders);
          // Dropped among the free sections: it also takes that place in the user's own order.
          if (folderId === null && beforeId) saveOrder(reorderPanels(defaultNavIds, sidebarOrder, panelId, beforeId));
        }}
        onGroupLinks={(panelId, targetId) => {
          const targetLabel = navPanels.find((panel) => panel.id === targetId)?.label ?? "";
          const draggedLabel = navPanels.find((panel) => panel.id === panelId)?.label ?? "";
          const before = sidebarFolders;
          const existingFolder = folderOf(before, targetId);
          const next = groupOnto(before, panelId, targetId, newFolderId(), [targetLabel, draggedLabel].filter(Boolean).join(", "));
          if (!next) return;
          saveFolders(next);
          toast({
            title: existingFolder ? `Добавлено в «${existingFolder.name}»` : `Группа «${next[next.length - 1]?.name ?? ""}» создана`,
            action: { label: "Отменить", onClick: () => saveFolders(before) }
          });
        }}
        variant={compact ? "drawer" : "rail"}
        position={sidebarPosition}
        drawerOpen={drawerOpen}
        onDrawerClose={() => setDrawerOpen(false)}
        header={({ open }) => (
          <div className="flex flex-col gap-2 rounded-lg px-1 py-1.5">
            <div className="flex items-center gap-2" title="KAIDEN Orion">
              <KaidenLogo className="h-7 w-7" />
              {open ? <span className="text-sm font-semibold tracking-tight text-foreground">ORION</span> : <span className="sr-only">ORION</span>}
            </div>
            {/*
             * Collapsed rail = avatar only (it still opens the list); expanded adds the
             * previous/next arrows and the name. Notifications live in the dockview tab
             * strip — the bell used to be clipped out of the 60px rail here.
             */}
            {!precision ? <WorkspaceSwitcher
              groups={switcherGroups}
              active={workspace}
              expanded={open}
              onSelect={requestWorkspaceSwitch}
              onOpenInNewWindow={(id) => void openWorkspaceInNewWindow(id, workspaces.find((w) => w.id === id)?.name ?? "ORION")}
              onOpenSpaces={() => leaveWorkbench("spaces")}
            /> : null}
          </div>
        )}
        links={orderedNav.map((panel) => ({
          id: panel.id,
          label: panel.label,
          icon: panel.icon,
          isActive: panel.id === activeNavId,
          group: panel.group,
          badge:
            panel.id === "inbox" && inboxCount > 0
              ? inboxCount
              : panel.id === "tasks" && overdueCount > 0
                ? overdueCount
                : undefined,
          badgeLabel:
            panel.id === "inbox" && inboxCount > 0
              ? `к разбору: ${inboxCount}`
              : panel.id === "tasks" && overdueCount > 0
                ? `просрочено в пространстве: ${overdueCount}`
                : undefined,
          onClick: () => openFromMenu(panel.id),
          // U06: drag the icon/label straight onto Dockview — the custom
          // mime type is how onReady's onWillShowOverlay/onDidDrop (above)
          // recognize this as a sidebar drag rather than dockview's own
          // internal tab-reorder drag or a stray OS file drop.
          onDragStart: (event: React.DragEvent<HTMLElement>) => {
            event.dataTransfer.setData(ORION_PANEL_DRAG_MIME, panel.id);
            event.dataTransfer.effectAllowed = "copy";
          },
          // Mouse-free alternatives to drag, reaching the same destinations
          // (U06 done-criterion): plain click already opens/focuses
          // (`onClick` above); this menu adds split and new-window.
          menuItems: [
            { label: "Открыть", onSelect: () => openFromMenu(panel.id) },
            { label: "Открыть рядом (сплит)", onSelect: () => openPanelSplit(panel.id) },
            { label: "Открыть во втором сайдбаре", onSelect: () => openInSecondaryDock(panel.id, panel.label) },
            ...(panelSupportsSurface(panel.id, "window")
              ? [{ label: "Открыть в новом окне", onSelect: () => void detachPanelToWindow(panel.id, panel.label) }]
              : []),
            "separator",
            // Folders: the same list a user sees, reachable without dragging anything.
            ...sidebarFolders
              .filter((folder) => folder.id !== folderOf(sidebarFolders, panel.id)?.id)
              .map((folder) => ({
                label: `В папку «${folder.name}»`,
                icon: Folder,
                onSelect: () => saveFolders(moveToFolder(sidebarFolders, panel.id, folder.id))
              })),
            ...(folderOf(sidebarFolders, panel.id)
              ? [{ label: "Убрать из папки", onSelect: () => saveFolders(moveToFolder(sidebarFolders, panel.id, null)) }]
              : []),
            { label: "В новую папку…", icon: FolderPlus, onSelect: () => setFolderDialog({ mode: "create", panelId: panel.id }) }
          ] satisfies (MenuItem | "separator")[]
        }))}
        LinkComponent={NextLink}
        footer={({ open }) =>
          open ? (
            <div className="flex flex-col gap-2">
              <DropdownMenu
                align="start"
                trigger={({ toggle }) => (
                  <button
                    type="button"
                    onClick={toggle}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                  >
                    <LayoutTemplate className="h-4 w-4 shrink-0" aria-hidden />
                    Раскладки
                  </button>
                )}
                items={[
                  { label: "Сохранить текущую…", onSelect: () => setLayoutDialogOpen(true) },
                  ...(layoutNames.length > 0 ? ["separator" as const] : []),
                  ...layoutNames.map((name, index) => ({
                    label: `${index < LAYOUT_SHORTCUT_COUNT ? `Alt+${index + 1}  ` : ""}${name}${name === layoutDefault ? "  ★" : ""}`,
                    onSelect: () => applyLayout(name)
                  })),
                  "separator" as const,
                  { label: "Управление: название, вход, перенос…", onSelect: () => setLayoutsManagerOpen(true) }
                ]}
              />
              <ExtensionSlot name="shell.sidebar.widgets" props={{ workspaceId: workspace?.id, open, onOpenCalendar: () => openFromMenu("calendar") }} />
              <button
                type="button"
                // The profile opens inside the workbench: leaving for /account dropped the open tabs' context.
                onClick={() => openSettings("profile")}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-white/5"
              >
                <AccountAvatar userId={user.id} name={user.name} hasAvatar={user.hasAvatar} size={28} />
                <span className="min-w-0 truncate text-2xs text-subtle-foreground">{user.name || user.email || "Учётка"}</span>
              </button>
              <button
                type="button"
                onClick={() => leaveWorkbench("spaces")}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              >
                Сменить пространство
              </button>
              <button
                onClick={() => leaveWorkbench("logout")}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              >
                <LogOut className="h-5 w-5 shrink-0" aria-hidden />
                Выйти
              </button>
            </div>
          ) : (
            // Collapsed rail: same icon-only rule as the header — email/chip
            // text used to render at full width here and wrap across several
            // lines inside the 60px column instead of being clipped.
            <IconButton
              label="Выйти"
              onClick={() => leaveWorkbench("logout")}
            >
              <LogOut className="h-4 w-4" />
            </IconButton>
          )
        }
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Precision has its own single top bar (below) — the floating corner is only for the legacy
            shell, which has no header of its own: there the dock's per-split tab-strip action bar used
            to carry its own «Настройки», multiplying with every split. */}
        {!compact && !precision ? <GlobalCorner /> : null}
        {compact ? (
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 pt-[env(safe-area-inset-top)]">
            <button
              type="button"
              aria-label="Открыть меню"
              aria-expanded={drawerOpen}
              aria-controls="orion-sidebar-nav"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-foreground hover:bg-white/5"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {getPanelDefinition(activePanelId ?? "dashboard")?.label ?? "ORION"}
            </span>
            <AgentPresencePill className="min-w-0" />
            <RunningTimerChip />
            <ResourcesToggle size="md" />
            <NotificationBell />
            <FeedbackButton />
            <IconButton label="Настройки" onClick={() => openPanel("settings")}>
              <Settings className="h-4 w-4" />
            </IconButton>
          </header>
        ) : null}
        {precision ? <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background px-3 py-1.5" aria-label="Рабочая область">
          <div className="flex shrink-0 items-center" role="group" aria-label="История переходов">
            <IconButton label="Назад (Alt+←)" className="h-11 w-11 sm:h-8 sm:w-8" disabled={!canStep(navHistory, -1, canShowPanel)} onClick={() => goHistory(-1)}><ChevronLeft className="h-4 w-4" /></IconButton>
            <IconButton label="Вперёд (Alt+→)" className="h-11 w-11 sm:h-8 sm:w-8" disabled={!canStep(navHistory, 1, canShowPanel)} onClick={() => goHistory(1)}><ChevronRight className="h-4 w-4" /></IconButton>
          </div>
          <IconButton id="orion-context-toggle" label="Контекст пространства" aria-controls="orion-workspace-context" className="h-11 w-11 sm:h-8 sm:w-8" onClick={() => compact ? setMobileContextOpen(value => !value) : setContextHidden(value => !value)} aria-expanded={compact ? mobileContextOpen : !contextHidden}><PanelLeft className="h-4 w-4" /></IconButton>
          <div className="min-w-0 flex-1 truncate text-label text-subtle-foreground"><span className="hidden text-muted-foreground md:inline">{workspace.name}</span><span aria-hidden className="hidden px-2 md:inline">/</span>{editorContext?.title || activeDefinition?.label || "Рабочая область"}</div>
          {editorContext ? <div role="status" aria-label={`Сохранение ${editorContext.entityType === "note" ? "заметки" : editorContext.entityType === "document" ? "документа" : "задачи"}`} className="hidden shrink-0 sm:block">{editorContext.saveState === "conflict" ? <span className="text-label text-warning">Конфликт версий</span> : <AutosaveStatus errorText="Не удалось сохранить — оставьте редактор открытым" state={editorContext.saveState} explicit={editorContext.saveMode === "explicit"} />}</div> : null}
          <AgentPresencePill />
          <IconButton label="Поиск и команды" className="h-11 w-11 sm:h-8 sm:w-8" onClick={showCommandPalette}><Search className="h-4 w-4" /></IconButton>
          <DropdownMenu align="end" trigger={({ toggle }) => <IconButton label="Рабочие раскладки" onClick={toggle}><LayoutTemplate className="h-4 w-4" /></IconButton>} items={[
            { label: "Сохранить текущую…", onSelect: () => setLayoutDialogOpen(true) },
            ...layoutNames.map(name => ({ label: name, onSelect: () => applyLayout(name) })),
            { label: "Управление раскладками", onSelect: () => setLayoutsManagerOpen(true) }
          ]} />
          {activeProjectId && !editorContext ? <IconButton id="orion-inspector-toggle" label="Свойства объекта" className="h-11 w-11 sm:h-8 sm:w-8" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(value => !value)}><PanelRight className="h-4 w-4" /></IconButton> : null}
          <IconButton label="Второй сайдбар" className="h-11 w-11 sm:h-8 sm:w-8" aria-expanded={secondaryDock.open} onClick={secondaryDock.toggle}><Columns2 className="h-4 w-4" /></IconButton>
          <FeedbackButton className="h-11 w-11 sm:h-8 sm:w-8" />
          <IconButton label="Настройки" className="h-11 w-11 sm:h-8 sm:w-8" onClick={() => openPanel("settings")}><Settings className="h-4 w-4" /></IconButton>
          <button type="button" aria-label="Учётная запись" onClick={() => openSettings("profile")} className="rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><AccountAvatar userId={user.id} name={user.name} hasAvatar={user.hasAvatar} size={24} /></button>
        </header> : null}
        <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {precision && !compact && !contextHidden ? <div className="w-60 shrink-0 border-r border-border">
            <WorkspaceContext key={workspace.id} userId={user.id} workspaceId={workspace.id} activeProjectId={activeProjectId} activeKind={activeDefinition?.navParent ?? activeDefinition?.id}
              projectsEnabled={navPanels.some(panel => panel.id === "projects")} views={projectViews} folders={folderViews}
              links={orderedNav.map(panel => ({ id: panel.id, label: panel.label, icon: panel.icon, onClick: () => openFromMenu(panel.id) }))}
              switcher={<WorkspaceSwitcher groups={switcherGroups} active={workspace} expanded alwaysList onSelect={requestWorkspaceSwitch} onOpenInNewWindow={(id) => void openWorkspaceInNewWindow(id, workspaces.find(w => w.id === id)?.name ?? "ORION")} onOpenSpaces={() => leaveWorkbench("spaces")} />}
              onOpen={openContextProject} onClose={() => { document.getElementById("orion-context-toggle")?.focus(); setContextHidden(true); }} />
          </div> : null}
          {!compact && secondaryDock.open && secondaryDock.position === "left" ? secondaryDockColumn : null}
          <div className="min-h-0 min-w-0 flex-1">
            <AgentPresenceFeed />
            <Workbench components={panelComponents} onReady={onReady} onRequestClose={closeTab} rightHeaderActionsComponent={HeaderActions} />
          </div>
          {!compact && secondaryDock.open && secondaryDock.position === "right" ? secondaryDockColumn : null}
          {precision && inspectorOpen && !editorContext && activeProjectId && wideInspector ? <div className="w-72 shrink-0 border-l border-border"><ProjectContextInspector key={`${workspace.id}:${activeProjectId}`} workspaceId={workspace.id} workspaceName={workspace.name} projectId={activeProjectId} views={projectViews} onOpen={(id, title) => openContextProject(id, title, "open")} onClose={() => { document.getElementById("orion-inspector-toggle")?.focus(); setInspectorOpen(false); }} /></div> : null}
          <ResourcesDock />
        </main>
      </div>
      <Sheet open={Boolean(precision && compact && mobileContextOpen)} onClose={() => setMobileContextOpen(false)} title="Навигация пространства" bare width="22rem">
        <WorkspaceContext key={workspace.id} userId={user.id} workspaceId={workspace.id} activeProjectId={activeProjectId} activeKind={activeDefinition?.navParent ?? activeDefinition?.id}
          projectsEnabled={navPanels.some(panel => panel.id === "projects")} views={projectViews} folders={folderViews}
          links={orderedNav.map(panel => ({ id: panel.id, label: panel.label, icon: panel.icon, onClick: () => { openFromMenu(panel.id); setMobileContextOpen(false); } }))}
          switcher={<WorkspaceSwitcher groups={switcherGroups} active={workspace} expanded alwaysList onSelect={id => { requestWorkspaceSwitch(id); setMobileContextOpen(false); }} onOpenInNewWindow={(id) => void openWorkspaceInNewWindow(id, workspaces.find(w => w.id === id)?.name ?? "ORION")} onOpenSpaces={() => leaveWorkbench("spaces")} />}
          onOpen={openContextProject} onClose={() => setMobileContextOpen(false)} />
      </Sheet>
      <Sheet open={Boolean(precision && inspectorOpen && !editorContext && activeProjectId && !wideInspector)} onClose={() => setInspectorOpen(false)} title="Контекст проекта" bare width="22rem">
        {activeProjectId ? <ProjectContextInspector key={`${workspace.id}:${activeProjectId}`} workspaceId={workspace.id} workspaceName={workspace.name} projectId={activeProjectId} views={projectViews} onOpen={(id, title) => { openContextProject(id, title, "open"); setInspectorOpen(false); }} onClose={() => setInspectorOpen(false)} /> : null}
      </Sheet>
      <ConfirmDialog
        open={pendingSwitch !== null}
        title="Есть несохранённый текст"
        description="При переходе в другое пространство введённое, но ещё не сохранённое пропадёт. Перейти?"
        confirmLabel="Перейти"
        danger={false}
        onConfirm={confirmPendingSwitch}
        onCancel={cancelPendingSwitch}
      />
      <ConfirmDialog
        open={pendingExit !== null}
        title="Есть несохранённый текст"
        description="При выходе из рабочей области введённое, но ещё не сохранённое пропадёт. Продолжить?"
        confirmLabel="Продолжить"
        onConfirm={() => {
          const destination = pendingExit;
          setPendingExit(null);
          if (destination === "logout") {
            play("auth.logout");
            logout.mutate(undefined, { onSuccess: () => router.replace("/login") });
          } else if (destination) router.push("/spaces");
        }}
        onCancel={() => setPendingExit(null)}
      />
      <CommandCenter />
      <ConfirmDialog
        open={pendingTabClose !== null}
        title="Закрыть вкладку без сохранения?"
        description="В этой вкладке есть изменения, которые ещё не сохранены. При закрытии они пропадут."
        confirmLabel="Закрыть"
        onConfirm={() => {
          const panelId = pendingTabClose;
          setPendingTabClose(null);
          if (panelId) apiRef.current?.getPanel(panelId)?.api.close();
        }}
        onCancel={() => setPendingTabClose(null)}
      />
      <NodeBadge />
      {children}
    </div>
    </ShortcutsProvider>
  );
}

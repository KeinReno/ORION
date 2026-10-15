"use client";

import { KaidenLogo } from "../../components/kaiden-logo";

import { useInbox, useLogout, usePreferences, useSession, useTasks, useWorkspaceOrganization } from "@orion/core-react";
import { effectiveDisabledModules, isModuleEnabled, isTaskClosed } from "@orion/shared-types";
import {
  AppBackground,
  DropdownMenu,
  IconButton,
  Sidebar,
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
  type IDockviewPanelProps,
  ConfirmDialog,
  cx,
  type MenuItem,
  type SidebarFolderView
} from "@orion/ui";
import { Folder, FolderPlus, LayoutTemplate, LogOut, Menu, Settings, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccountAvatar } from "../../components/account-avatar";
import { CommandCenter } from "../../lib/command-center";
import { NotificationBell } from "../../components/notification-bell";
import { FolderNameDialog } from "../../components/folder-name-dialog";
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
import { openPanel as focusPanel, registerPanelBus } from "../../lib/panel-bus";
import { getPanelDefinition, isPanelAvailable, panelInstanceId, panelRegistry, visiblePanels } from "../../lib/panel-registry";
import { getActiveWorkspaceId, setActiveWorkspaceId, useActiveWorkspace } from "../../lib/use-active-workspace";
import { ExtensionSlot } from "../../lib/extensions/slot";
import { detachPanelToWindow, openWorkspaceInNewWindow } from "../../lib/panel-window";
import { useDesktopDueReminders } from "../../lib/use-desktop-due-reminders";
import { addFolder, deleteFolder, folderOf, moveFolder, moveToFolder, orderedIds, placeInFolder, renameFolder, reorderPanels, toggleFolder } from "../../lib/sidebar-folders";
import { PanelDraftScope, cancelPendingSwitch, confirmPendingSwitch, hasUnsavedDrafts, requestWorkspaceSwitch, usePendingSwitch } from "../../lib/unsaved-drafts";
import { newFolderId, useSidebarFolders } from "../../lib/use-sidebar-folders";
import { buildSwitcherGroups } from "../../lib/workspace-order";

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
const panelComponents: Record<string, (props: IDockviewPanelProps) => React.ReactElement> = Object.fromEntries(
  panelRegistry.map((panel) => [
    panel.id,
    (props: IDockviewPanelProps) => createElement(PanelDraftScope, { panelId: props.api.id }, createElement(panel.component, { params: props.params, api: props.api }))
  ])
);

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
  if (!isTauri() || !activePanel) return null;

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
  if (!activePanel) return null;
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
        onOpenAllSettings={() => {
          setModuleSettingsFor(null);
          focusPanel("settings");
        }}
      />
      <FloatHeaderAction {...props} />
      <DetachHeaderAction {...props} />
      <RunningTimerChip />
      <NotificationBell size="sm" />
      <button
        type="button"
        onClick={() => focusPanel("settings")}
        title="Настройки"
        className="mr-2 flex h-6 w-6 items-center justify-center rounded text-subtle-foreground hover:bg-white/10 hover:text-foreground"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }): React.ReactElement {
  const router = useRouter();
  const { user, isLoading, status, previousUser, retry: retrySession } = useSession();
  const logout = useLogout();
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
  const navPanels = visiblePanels(disabledModules, preferences?.hiddenModules);

  // The user's own sidebar folders: personal, saved with their preferences.
  const { folders: sidebarFolders, save: saveFolders, order: sidebarOrder, saveOrder } = useSidebarFolders();
  const sidebarPosition = preferences?.sidebarPosition ?? "left";
  const pendingSwitch = usePendingSwitch();
  const [pendingExit, setPendingExit] = useState<"spaces" | "account" | "logout" | null>(null);
  const [pendingTabClose, setPendingTabClose] = useState<string | null>(null);
  const leaveWorkbench = useCallback((destination: "spaces" | "account" | "logout") => {
    if (hasUnsavedDrafts()) {
      setPendingExit(destination);
      return;
    }
    if (destination === "logout") logout.mutate(undefined, { onSuccess: () => router.replace("/login") });
    else router.push(destination === "spaces" ? "/spaces" : "/account");
  }, [logout, router]);
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

  const apiRef = useRef<DockviewApi | null>(null);
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
  // Alt+1..Alt+9 apply the first nine layouts, in the order the menu shows them.
  const layoutNamesRef = useRef(layoutNames);
  layoutNamesRef.current = layoutNames;
  const applyLayoutRef = useRef(applyLayout);
  applyLayoutRef.current = applyLayout;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const index = layoutShortcutIndex(event);
      if (index === null || event.repeat) return;
      const name = layoutNamesRef.current[index];
      if (name === undefined) return;
      event.preventDefault();
      applyLayoutRef.current(name);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
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
  // A project tab (`project:<id>`) keeps "Проекты" lit in the sidebar.
  const activeDefinition = activePanelId ? getPanelDefinition(activePanelId) : undefined;
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
          api.fromJSON(JSON.parse(raw));
          restored = true;
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

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;
      registerPanelBus({ openPanel });

      api.onDidActivePanelChange((panel) => setActivePanelId(panel?.id ?? null));

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
    [openPanel, placePanel, loadLayoutForKey, user, workspace]
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
    if (status === "authenticated" && !workspacesLoading && !workspace) {
      router.replace("/spaces");
    }
  }, [status, workspacesLoading, workspace, router]);

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
    return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Загрузка…</div>;
  }

  return (
    <div
      className={cx(
        "flex h-dvh bg-background",
        compact && "orion-shell--compact",
        // The phone always uses the left drawer; the menu's own edge applies to the desktop shell.
        !compact && sidebarPosition === "right" && "flex-row-reverse",
        !compact && sidebarPosition === "top" && "flex-col",
        !compact && sidebarPosition === "bottom" && "flex-col-reverse"
      )}
    >
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
        folders={folderViews}
        onToggleFolder={(id) => saveFolders(toggleFolder(sidebarFolders, id))}
        onCreateFolder={(panelId) => setFolderDialog({ mode: "create", panelId })}
        onMoveLink={(panelId, folderId, beforeId) => {
          const nextFolders = placeInFolder(sidebarFolders, panelId, folderId, beforeId);
          if (nextFolders.some((folder, index) => folder.items.join() !== sidebarFolders[index]?.items.join())) saveFolders(nextFolders);
          // Dropped among the free sections: it also takes that place in the user's own order.
          if (folderId === null && beforeId) saveOrder(reorderPanels(defaultNavIds, sidebarOrder, panelId, beforeId));
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
            <WorkspaceSwitcher
              groups={switcherGroups}
              active={workspace}
              expanded={open}
              onSelect={requestWorkspaceSwitch}
              onOpenInNewWindow={(id) => void openWorkspaceInNewWindow(id, workspaces.find((w) => w.id === id)?.name ?? "ORION")}
              onOpenSpaces={() => leaveWorkbench("spaces")}
            />
          </div>
        )}
        links={orderedNav.map((panel) => ({
          id: panel.id,
          label: panel.label,
          icon: panel.icon,
          isActive: panel.id === (activeDefinition?.navParent ?? activeDefinition?.id),
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
            { label: "Открыть в новом окне", onSelect: () => void detachPanelToWindow(panel.id, panel.label) },
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
                onClick={() => leaveWorkbench("account")}
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
            <RunningTimerChip />
            <NotificationBell />
            <IconButton label="Настройки" onClick={() => openPanel("settings")}>
              <Settings className="h-4 w-4" />
            </IconButton>
          </header>
        ) : null}
        <main className="min-h-0 flex-1 overflow-hidden">
          <Workbench components={panelComponents} onReady={onReady} onRequestClose={closeTab} rightHeaderActionsComponent={HeaderActions} />
        </main>
      </div>
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
          if (destination === "logout") logout.mutate(undefined, { onSuccess: () => router.replace("/login") });
          else if (destination) router.push(destination === "spaces" ? "/spaces" : "/account");
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
      {children}
    </div>
  );
}

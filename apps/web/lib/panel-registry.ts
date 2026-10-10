import { isModuleEnabled, type OrionModuleId } from "@orion/shared-types";
import {
  Boxes,
  CalendarDays,
  FolderKanban,
  FolderOpen,
  GanttChartSquare,
  Globe2,
  Inbox,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  RefreshCw,
  Settings,
  Share2,
  StickyNote,
  Target,
  Timer,
  Wallet,
  type LucideIcon
} from "lucide-react";
import dynamic from "next/dynamic";
import { createElement, type FunctionComponent } from "react";

/**
 * What a panel component may receive. Dockview passes its own
 * `IDockviewPanelProps` (structurally a superset of this); the detached
 * `/panel/[panelId]` window passes just `params`. Ordinary single-instance
 * panels ignore both.
 */
export interface PanelComponentProps {
  params?: { instanceId?: string };
  api?: { setTitle: (title: string) => void };
}

export interface PanelDefinition {
  id: string;
  label: string;
  icon: LucideIcon;
  component: FunctionComponent<PanelComponentProps>;
  /** Domain module that owns this panel. Absent = core shell, always visible. */
  moduleId?: OrionModuleId;
  /** Opened from elsewhere (e.g. the settings gear), not from the sidebar link list. */
  hideFromNav?: boolean;
  /** Sidebar section (see `Sidebar`'s `SidebarLinkItem.group`). Absent = the ungrouped "Сегодня" cluster at the top. */
  group?: string;
  /**
   * Multi-instance panel: opened as `<id>:<instanceId>` (e.g. `project:<projectId>`),
   * one dock tab per record instead of one per module. The component reads the
   * record id from `params.instanceId`.
   */
  instanced?: boolean;
  /** Sidebar item to highlight while this panel is active (an instanced panel belongs to its module's list). */
  navParent?: string;
}

const LazyDashboardPanel = dynamic(() => import("../panels/DashboardPanel").then((module) => module.DashboardPanel), { ssr: false });
const LazyTasksPanel = dynamic(() => import("../panels/TasksPanel").then((module) => module.TasksPanel), { ssr: false });
const LazyCalendarPanel = dynamic(() => import("../panels/CalendarPanel").then((module) => module.CalendarPanel), { ssr: false });
const LazyNotesPanel = dynamic(() => import("../panels/NotesPanel").then((module) => module.NotesPanel), { ssr: false });
const LazyProjectsPanel = dynamic(() => import("../panels/ProjectsPanel").then((module) => module.ProjectsPanel), { ssr: false });
const LazyProjectWorkspacePanel = dynamic(
  () => import("../panels/ProjectWorkspacePanel").then((module) => module.ProjectWorkspacePanel),
  { ssr: false }
);
const LazyProjectPlanPanel = dynamic(() => import("../panels/ProjectViewPanels").then((module) => module.ProjectPlanPanel), { ssr: false });
const LazyProjectMaterialsPanel = dynamic(
  () => import("../panels/ProjectViewPanels").then((module) => module.ProjectMaterialsPanel),
  { ssr: false }
);
const LazyInboxPanel = dynamic(() => import("../panels/InboxPanel").then((module) => module.InboxPanel), { ssr: false });
const LazyOverviewPanel = dynamic(() => import("../panels/OverviewPanel").then((module) => module.OverviewPanel), { ssr: false });
const LazySharedPanel = dynamic(() => import("../panels/SharedPanel").then((module) => module.SharedPanel), { ssr: false });
const LazyTimePanel = dynamic(() => import("../panels/TimePanel").then((module) => module.TimePanel), { ssr: false });
const LazyHabitsPanel = dynamic(() => import("../panels/HabitsPanel").then((module) => module.HabitsPanel), { ssr: false });
const LazyListsPanel = dynamic(() => import("../panels/ListsPanel").then((module) => module.ListsPanel), { ssr: false });
const LazyFinancePanel = dynamic(() => import("../panels/FinancePanel").then((module) => module.FinancePanel), { ssr: false });
const LazyInventoryPanel = dynamic(() => import("../panels/InventoryPanel").then((module) => module.InventoryPanel), { ssr: false });
const LazyDocumentsPanel = dynamic(() => import("../panels/DocumentsPanel").then((module) => module.DocumentsPanel), { ssr: false });
const LazySyncPanel = dynamic(() => import("../panels/SyncPanel").then((module) => module.SyncPanel), { ssr: false });
const LazySettingsPanel = dynamic(() => import("../panels/SettingsPanel").then((module) => module.SettingsPanel), { ssr: false });

const DashboardPanel: FunctionComponent = () => createElement(LazyDashboardPanel);
const TasksPanel: FunctionComponent = () => createElement(LazyTasksPanel);
const CalendarPanel: FunctionComponent = () => createElement(LazyCalendarPanel);
const NotesPanel: FunctionComponent = () => createElement(LazyNotesPanel);
const ProjectsPanel: FunctionComponent = () => createElement(LazyProjectsPanel);
const ProjectWorkspacePanel: FunctionComponent<PanelComponentProps> = (props) =>
  createElement(LazyProjectWorkspacePanel, props);
const ProjectPlanPanel: FunctionComponent<PanelComponentProps> = (props) => createElement(LazyProjectPlanPanel, props);
const ProjectMaterialsPanel: FunctionComponent<PanelComponentProps> = (props) =>
  createElement(LazyProjectMaterialsPanel, props);
const InboxPanel: FunctionComponent = () => createElement(LazyInboxPanel);
const OverviewPanel: FunctionComponent = () => createElement(LazyOverviewPanel);
const SharedPanel: FunctionComponent = () => createElement(LazySharedPanel);
const TimePanel: FunctionComponent = () => createElement(LazyTimePanel);
const HabitsPanel: FunctionComponent = () => createElement(LazyHabitsPanel);
const ListsPanel: FunctionComponent = () => createElement(LazyListsPanel);
const FinancePanel: FunctionComponent = () => createElement(LazyFinancePanel);
const InventoryPanel: FunctionComponent = () => createElement(LazyInventoryPanel);
const DocumentsPanel: FunctionComponent = () => createElement(LazyDocumentsPanel);
const SyncPanel: FunctionComponent = () => createElement(LazySyncPanel);
const SettingsPanel: FunctionComponent = () => createElement(LazySettingsPanel);

/**
 * Modules are loaded on demand: opening the shell no longer downloads every
 * panel and its editor/preview dependencies. Adding a module only changes
 * this registry; Sidebar and Workbench remain generic.
 */
export const panelRegistry: PanelDefinition[] = [
  { id: "dashboard", label: "Дашборд", icon: LayoutDashboard, component: DashboardPanel },
  { id: "inbox", label: "Инбокс", icon: Inbox, component: InboxPanel },
  // U08 — cross-workspace, not gated by any single workspace's module state
  // (see OverviewPanel's doc comment); ungrouped alongside dashboard/inbox
  // for the same reason those two aren't under a `group`.
  { id: "overview", label: "Обзор", icon: Globe2, component: OverviewPanel },
  // U09 — cross-workspace grantee list, same reasoning as "overview" for why
  // it isn't gated by any single workspace's module state (see SharedPanel).
  { id: "shared", label: "Доступно мне", icon: Share2, component: SharedPanel },
  { id: "tasks", label: "Задачи", icon: ListTodo, component: TasksPanel, moduleId: "tasks", group: "Работа" },
  { id: "calendar", label: "Календарь", icon: CalendarDays, component: CalendarPanel, moduleId: "calendar", group: "Работа" },
  { id: "notes", label: "Заметки", icon: StickyNote, component: NotesPanel, moduleId: "notes", group: "Работа" },
  { id: "projects", label: "Проекты", icon: FolderKanban, component: ProjectsPanel, moduleId: "projects", group: "Работа" },
  {
    id: "project",
    label: "Проект",
    icon: FolderKanban,
    component: ProjectWorkspacePanel,
    moduleId: "projects",
    hideFromNav: true,
    instanced: true,
    navParent: "projects"
  },
  // Large views of one project as their own panels (UI-06, ADR-0003): the same components the
  // project tabs render, so a plan can sit beside the overview or on a second monitor.
  {
    id: "projectplan",
    label: "План проекта",
    icon: GanttChartSquare,
    component: ProjectPlanPanel,
    moduleId: "projects",
    hideFromNav: true,
    instanced: true,
    navParent: "projects"
  },
  {
    id: "projectmaterials",
    label: "Материалы проекта",
    icon: FolderOpen,
    component: ProjectMaterialsPanel,
    moduleId: "projects",
    hideFromNav: true,
    instanced: true,
    navParent: "projects"
  },
  { id: "time", label: "Время", icon: Timer, component: TimePanel, moduleId: "time", group: "Работа" },
  { id: "habits", label: "Привычки", icon: Target, component: HabitsPanel, moduleId: "habits", group: "Работа" },
  { id: "lists", label: "Списки", icon: ListChecks, component: ListsPanel, moduleId: "lists", group: "Работа" },
  { id: "finance", label: "Финансы", icon: Wallet, component: FinancePanel, moduleId: "finance", group: "Деньги и склад" },
  { id: "inventory", label: "Склад", icon: Boxes, component: InventoryPanel, moduleId: "inventory", group: "Деньги и склад" },
  { id: "documents", label: "Документы", icon: FolderOpen, component: DocumentsPanel, moduleId: "documents", group: "Файлы и система" },
  { id: "sync", label: "Резервные копии", icon: RefreshCw, component: SyncPanel, group: "Файлы и система" },
  { id: "settings", label: "Настройки", icon: Settings, component: SettingsPanel, hideFromNav: true }
];

/**
 * Sidebar entries. `disabledModules` is the workspace-level switch (also gates
 * the API); `personallyHidden` is the viewer's own "don't show me this" list —
 * navigation only, so it never drops shell panels (no `moduleId`) and never
 * touches data or the panel if it is already open or reached another way.
 */
export function visiblePanels(
  disabledModules: readonly string[] | undefined,
  personallyHidden: readonly string[] = []
): PanelDefinition[] {
  return panelRegistry.filter(
    (panel) =>
      !panel.hideFromNav &&
      (!panel.moduleId || (isModuleEnabled(disabledModules, panel.moduleId) && !personallyHidden.includes(panel.moduleId)))
  );
}

const INSTANCE_SEPARATOR = ":";

/** `project:abc` → `project`; a plain id is its own kind. */
export function panelKind(panelId: string): string {
  const at = panelId.indexOf(INSTANCE_SEPARATOR);
  return at === -1 ? panelId : panelId.slice(0, at);
}

/** `project:abc` → `abc`; null for a single-instance panel id. */
export function panelInstanceId(panelId: string): string | null {
  const at = panelId.indexOf(INSTANCE_SEPARATOR);
  return at === -1 ? null : panelId.slice(at + 1) || null;
}

export function instancePanelId(kind: string, instanceId: string): string {
  return `${kind}${INSTANCE_SEPARATOR}${instanceId}`;
}

/**
 * Resolves both plain ids and instance ids (`project:abc`) to their
 * definition. An instance id of a non-instanced kind, or a bare instanced
 * kind with no record id, resolves to nothing — there is no panel to open.
 */
export function getPanelDefinition(panelId: string): PanelDefinition | undefined {
  const definition = panelRegistry.find((panel) => panel.id === panelKind(panelId));
  if (!definition) return undefined;
  const hasInstance = panelInstanceId(panelId) !== null;
  return Boolean(definition.instanced) === hasInstance ? definition : undefined;
}

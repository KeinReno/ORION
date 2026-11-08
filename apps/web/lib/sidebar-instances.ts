/**
 * Sidebar System 2.0 — up to three equal navigation bars.
 * Pure data: storage and React live elsewhere. Moving a panel only changes
 * where its shortcut sits. It never turns a module on or off and never
 * opens or closes a workbench tab.
 */

import type { SidebarFolder } from "@orion/shared-types";
import { addFolder, deleteFolder, groupOnto, moveFolder, placeInFolder, renameFolder, toggleFolder } from "./sidebar-folders";

export const NAV_SIDEBAR_LIMIT = 3;
export const PRIMARY_SIDEBAR_ID = "primary";

export type NavEdge = "left" | "right" | "top" | "bottom";
export type NavDensity = "full" | "compact" | "icons";

export interface NavSidebarConfig {
  id: string;
  name: string;
  edge: NavEdge;
  density: NavDensity;
  /** Shortcut order for panels that are not inside a folder. */
  order: string[];
  folders: SidebarFolder[];
}

export interface NavSidebarState {
  sidebars: NavSidebarConfig[];
  /** panel id -> sidebar id. Absent means the primary sidebar. */
  placement: Record<string, string>;
}

export interface NavDropTarget {
  /** null takes the shortcut out of every folder on the destination bar. */
  folderId?: string | null;
  beforeId?: string;
  /** Visible shortcut ids, so a drop at the end stays at the end of that list. */
  catalog?: readonly string[];
}

const EDGES: readonly NavEdge[] = ["left", "right", "top", "bottom"];
const DENSITIES: readonly NavDensity[] = ["full", "compact", "icons"];
/** New bars take the first of these that nobody is using yet. `top` is a manual choice. */
const CREATE_EDGES: readonly NavEdge[] = ["left", "right", "bottom"];
const FALLBACK_NAME = "Сайдбар";

function isEdge(value: unknown): value is NavEdge {
  return typeof value === "string" && (EDGES as readonly string[]).includes(value);
}

function isDensity(value: unknown): value is NavDensity {
  return typeof value === "string" && (DENSITIES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanName(name: unknown): string {
  if (typeof name !== "string") return FALLBACK_NAME;
  const trimmed = name.trim();
  return trimmed === "" ? FALLBACK_NAME : trimmed;
}

function emptyBar(id: string, name: string, edge: NavEdge, density: NavDensity): NavSidebarConfig {
  return { id, name, edge, density, order: [], folders: [] };
}

function primarySidebar(): NavSidebarConfig {
  return emptyBar(PRIMARY_SIDEBAR_ID, "Основной", "left", "full");
}

export function initialNavSidebars(): NavSidebarState {
  return { sidebars: [primarySidebar()], placement: {} };
}

function stripPanel(bar: NavSidebarConfig, panelId: string): NavSidebarConfig {
  const order = bar.order.filter((id) => id !== panelId);
  const folders = bar.folders.map((folder) =>
    folder.items.includes(panelId) ? { ...folder, items: folder.items.filter((id) => id !== panelId) } : folder,
  );
  if (order.length === bar.order.length && folders.every((folder, index) => folder === bar.folders[index])) return bar;
  return { ...bar, order, folders };
}

function barOf(state: NavSidebarState, panelId: string): string {
  return state.placement[panelId] ?? PRIMARY_SIDEBAR_ID;
}

export function parseNavSidebarState(raw: unknown): NavSidebarState {
  if (!isRecord(raw) || !Array.isArray(raw.sidebars)) return initialNavSidebars();

  const parsed: NavSidebarConfig[] = [];
  const seen = new Set<string>();
  for (const entry of raw.sidebars) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id === "" || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const rawOrder = Array.isArray(entry.order) ? entry.order : [];
    const order = rawOrder.filter((id, index): id is string => typeof id === "string" && id !== "" && rawOrder.indexOf(id) === index);
    parsed.push({
      id: entry.id,
      name: cleanName(entry.name),
      edge: isEdge(entry.edge) ? entry.edge : "left",
      density: isDensity(entry.density) ? entry.density : "full",
      order,
      folders: normalizeOwnedFolders(entry.folders),
    });
  }

  const primary = parsed.find((sidebar) => sidebar.id === PRIMARY_SIDEBAR_ID) ?? primarySidebar();
  const rest = parsed.filter((sidebar) => sidebar.id !== PRIMARY_SIDEBAR_ID);
  const sidebars = [primary, ...rest].slice(0, NAV_SIDEBAR_LIMIT);
  const ids = new Set(sidebars.map((sidebar) => sidebar.id));

  const placement: Record<string, string> = {};
  if (isRecord(raw.placement)) {
    for (const [panelId, sidebarId] of Object.entries(raw.placement)) {
      if (panelId === "" || typeof sidebarId !== "string" || !ids.has(sidebarId)) continue;
      placement[panelId] = sidebarId;
    }
  }

  const claimed = new Set<string>();
  const cleaned = sidebars.map((sidebar) => {
    const folders = sidebar.folders.map((folder) => ({
      ...folder,
      items: folder.items.filter((panelId) => {
        if (claimed.has(panelId) || barOf({ sidebars, placement }, panelId) !== sidebar.id) return false;
        claimed.add(panelId);
        return true;
      }),
    }));
    const order = sidebar.order.filter((panelId) => {
      if (claimed.has(panelId) || barOf({ sidebars, placement }, panelId) !== sidebar.id) return false;
      claimed.add(panelId);
      return true;
    });
    return { ...sidebar, folders, order };
  });

  return { sidebars: cleaned, placement };
}

function normalizeOwnedFolders(raw: unknown): SidebarFolder[] {
  if (!Array.isArray(raw)) return [];
  const seenFolders = new Set<string>();
  const seenItems = new Set<string>();
  const out: SidebarFolder[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id === "" || seenFolders.has(entry.id)) continue;
    if (typeof entry.name !== "string" || entry.name.trim() === "") continue;
    seenFolders.add(entry.id);
    const items: string[] = [];
    for (const item of Array.isArray(entry.items) ? entry.items : []) {
      if (typeof item !== "string" || item === "" || seenItems.has(item)) continue;
      seenItems.add(item);
      items.push(item);
    }
    out.push({ id: entry.id, name: entry.name.trim(), collapsed: entry.collapsed === true, items });
  }
  return out;
}

export function createNavSidebar(state: NavSidebarState): NavSidebarState {
  if (state.sidebars.length >= NAV_SIDEBAR_LIMIT) return state;
  const ids = new Set(state.sidebars.map((sidebar) => sidebar.id));
  const id = !ids.has("side-2") ? "side-2" : !ids.has("side-3") ? "side-3" : null;
  if (id === null) return state;
  const used = new Set(state.sidebars.map((sidebar) => sidebar.edge));
  const edge = CREATE_EDGES.find((candidate) => !used.has(candidate)) ?? "right";
  return {
    sidebars: [...state.sidebars, emptyBar(id, id === "side-2" ? "Второй" : "Третий", edge, "icons")],
    placement: state.placement,
  };
}

export function removeNavSidebar(state: NavSidebarState, id: string): NavSidebarState {
  const removed = state.sidebars.find((sidebar) => sidebar.id === id);
  if (id === PRIMARY_SIDEBAR_ID || !removed) return state;
  const placement: Record<string, string> = {};
  for (const [panelId, sidebarId] of Object.entries(state.placement)) {
    if (sidebarId !== id) placement[panelId] = sidebarId;
  }
  return { sidebars: state.sidebars.filter((sidebar) => sidebar.id !== id), placement };
}

export function updateNavSidebar(
  state: NavSidebarState,
  id: string,
  patch: Partial<Pick<NavSidebarConfig, "name" | "edge" | "density">>,
): NavSidebarState {
  const index = state.sidebars.findIndex((sidebar) => sidebar.id === id);
  if (index < 0) return state;
  const current = state.sidebars[index]!;
  const next: NavSidebarConfig = {
    ...current,
    ...(typeof patch.name === "string" ? { name: cleanName(patch.name) } : {}),
    ...(isEdge(patch.edge) ? { edge: patch.edge } : {}),
    ...(isDensity(patch.density) ? { density: patch.density } : {}),
  };
  if (next.name === current.name && next.edge === current.edge && next.density === current.density) return state;
  const sidebars = state.sidebars.slice();
  sidebars[index] = next;
  return { sidebars, placement: state.placement };
}

function replaceBar(state: NavSidebarState, sidebarId: string, bar: NavSidebarConfig): NavSidebarState {
  const index = state.sidebars.findIndex((sidebar) => sidebar.id === sidebarId);
  if (index < 0) return state;
  const sidebars = state.sidebars.slice();
  sidebars[index] = bar;
  return { sidebars, placement: state.placement };
}

/**
 * Moves one shortcut onto `sidebarId`. The previous state is returned unchanged
 * when the destination does not exist, so a failed drop cannot remove the shortcut.
 */
export function movePanelToSidebar(
  state: NavSidebarState,
  panelId: string,
  sidebarId: string,
  target: NavDropTarget = {},
): NavSidebarState {
  if (panelId === "") return state;
  if (target.beforeId === panelId && barOf(state, panelId) === sidebarId) return state;
  const destination = state.sidebars.find((sidebar) => sidebar.id === sidebarId);
  if (!destination) return state;
  if (target.folderId && !destination.folders.some((folder) => folder.id === target.folderId)) return state;

  const stripped = state.sidebars.map((sidebar) => stripPanel(sidebar, panelId));
  const index = stripped.findIndex((sidebar) => sidebar.id === sidebarId);
  const bar = stripped[index]!;
  const folderId = target.folderId === undefined ? folderHolding(bar, target.beforeId) : target.folderId;
  let nextBar = bar;
  if (folderId) {
    nextBar = { ...bar, folders: placeInFolder(bar.folders, panelId, folderId, target.beforeId) };
  } else {
    const pool = target.catalog ?? bar.order;
    const order = pool.filter(
      (id) => id !== panelId && barOf(state, id) === sidebarId && !bar.folders.some((folder) => folder.items.includes(id)),
    );
    const at = target.beforeId ? order.indexOf(target.beforeId) : -1;
    order.splice(at < 0 ? order.length : at, 0, panelId);
    nextBar = { ...bar, order };
  }
  const sidebars = stripped.slice();
  sidebars[index] = nextBar;
  const placement = { ...state.placement };
  if (sidebarId === PRIMARY_SIDEBAR_ID) delete placement[panelId];
  else placement[panelId] = sidebarId;
  const samePlace =
    barOf(state, panelId) === sidebarId &&
    JSON.stringify(state.sidebars) === JSON.stringify(sidebars);
  if (samePlace) return state;
  return { sidebars, placement };
}

function folderHolding(bar: NavSidebarConfig, beforeId: string | undefined): string | null {
  if (!beforeId) return null;
  return bar.folders.find((folder) => folder.items.includes(beforeId))?.id ?? null;
}

export function panelsForSidebar(state: NavSidebarState, sidebarId: string, panelIds: readonly string[]): string[] {
  const bar = state.sidebars.find((sidebar) => sidebar.id === sidebarId);
  if (!bar) return [];
  const visible = panelIds.filter((panelId) => barOf(state, panelId) === sidebarId);
  const known = new Set(visible);
  const inFolder = new Set(bar.folders.flatMap((folder) => folder.items));
  const ordered = bar.order.filter((panelId) => known.has(panelId) && !inFolder.has(panelId));
  const orderedSet = new Set(ordered);
  const rest = visible.filter((panelId) => !orderedSet.has(panelId) && !inFolder.has(panelId));
  const folderItems = bar.folders.flatMap((folder) => folder.items.filter((panelId) => known.has(panelId)));
  return [...ordered, ...rest, ...folderItems];
}

export function addNavFolder(
  state: NavSidebarState,
  sidebarId: string,
  name: string,
  folderId: string,
  firstItem?: string,
): NavSidebarState {
  const bar = state.sidebars.find((sidebar) => sidebar.id === sidebarId);
  if (!bar) return state;
  const placed = firstItem ? movePanelToSidebar(state, firstItem, sidebarId) : state;
  const host = placed.sidebars.find((sidebar) => sidebar.id === sidebarId)!;
  const folders = addFolder(host.folders, name, folderId, firstItem);
  if (!folders) return state;
  const withFolder = replaceBar(placed, sidebarId, { ...host, folders, order: host.order.filter((id) => id !== firstItem) });
  return firstItem ? { ...withFolder, sidebars: withFolder.sidebars } : withFolder;
}

export function renameNavFolder(state: NavSidebarState, sidebarId: string, folderId: string, name: string): NavSidebarState {
  const bar = state.sidebars.find((sidebar) => sidebar.id === sidebarId);
  if (!bar) return state;
  const folders = renameFolder(bar.folders, folderId, name);
  if (!folders) return state;
  return replaceBar(state, sidebarId, { ...bar, folders });
}

export function deleteNavFolder(state: NavSidebarState, sidebarId: string, folderId: string): NavSidebarState {
  const bar = state.sidebars.find((sidebar) => sidebar.id === sidebarId);
  if (!bar) return state;
  const folder = bar.folders.find((entry) => entry.id === folderId);
  if (!folder) return state;
  return replaceBar(state, sidebarId, {
    ...bar,
    folders: deleteFolder(bar.folders, folderId),
    order: [...bar.order, ...folder.items.filter((id) => !bar.order.includes(id))],
  });
}

export function toggleNavFolder(state: NavSidebarState, sidebarId: string, folderId: string): NavSidebarState {
  const bar = state.sidebars.find((sidebar) => sidebar.id === sidebarId);
  if (!bar) return state;
  return replaceBar(state, sidebarId, { ...bar, folders: toggleFolder(bar.folders, folderId) });
}

export function moveNavFolder(state: NavSidebarState, sidebarId: string, folderId: string, delta: -1 | 1): NavSidebarState {
  const bar = state.sidebars.find((sidebar) => sidebar.id === sidebarId);
  if (!bar) return state;
  return replaceBar(state, sidebarId, { ...bar, folders: moveFolder(bar.folders, folderId, delta) });
}

export function groupPanelOnto(
  state: NavSidebarState,
  sidebarId: string,
  draggedId: string,
  targetId: string,
  folderId: string,
  name: string,
): NavSidebarState {
  const placed = movePanelToSidebar(state, draggedId, sidebarId);
  const bar = placed.sidebars.find((sidebar) => sidebar.id === sidebarId);
  if (!bar || barOf(placed, targetId) !== sidebarId) return state;
  const folders = groupOnto(bar.folders, draggedId, targetId, folderId, name);
  if (!folders) return state;
  return replaceBar(placed, sidebarId, {
    ...bar,
    folders,
    order: bar.order.filter((id) => id !== draggedId && id !== targetId),
  });
}

/** Copies the old preference folders onto the primary bar once, and only onto that bar. */
export function seedPrimaryFolders(
  state: NavSidebarState,
  folders: readonly SidebarFolder[],
  order: readonly string[],
): NavSidebarState {
  const primary = state.sidebars.find((sidebar) => sidebar.id === PRIMARY_SIDEBAR_ID);
  if (!primary || primary.folders.length > 0 || primary.order.length > 0) return state;
  if (folders.length === 0 && order.length === 0) return state;
  const away = new Set(
    Object.entries(state.placement)
      .filter(([, sidebarId]) => sidebarId !== PRIMARY_SIDEBAR_ID)
      .map(([panelId]) => panelId),
  );
  const nextFolders = folders
    .map((folder) => ({ ...folder, items: folder.items.filter((id) => !away.has(id)) }))
    .filter((folder) => folder.items.length > 0 || folder.name.trim() !== "");
  const nextOrder = order.filter((id) => !away.has(id));
  if (nextFolders.length === 0 && nextOrder.length === 0) return state;
  return replaceBar(state, PRIMARY_SIDEBAR_ID, { ...primary, folders: nextFolders, order: nextOrder });
}

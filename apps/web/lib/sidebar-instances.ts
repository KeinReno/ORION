/**
 * Sidebar System 2.0 — which navigation bars exist and which panel sits in which bar.
 * Pure data: storage and React live elsewhere. Moving a panel only changes `placement`;
 * it never turns a module on or off. A panel with no placement entry stays on the primary bar.
 */

export const NAV_SIDEBAR_LIMIT = 3;
export const PRIMARY_SIDEBAR_ID = "primary";

export type NavEdge = "left" | "right" | "top" | "bottom";
export type NavDensity = "full" | "compact" | "icons";

export interface NavSidebarConfig {
  id: string;
  name: string;
  edge: NavEdge;
  density: NavDensity;
}

export interface NavSidebarState {
  sidebars: NavSidebarConfig[];
  /** panel id -> sidebar id. Absent means the primary sidebar. */
  placement: Record<string, string>;
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

function primarySidebar(): NavSidebarConfig {
  return { id: PRIMARY_SIDEBAR_ID, name: "Основной", edge: "left", density: "full" };
}

export function initialNavSidebars(): NavSidebarState {
  return { sidebars: [primarySidebar()], placement: {} };
}

export function parseNavSidebarState(raw: unknown): NavSidebarState {
  if (!isRecord(raw) || !Array.isArray(raw.sidebars)) return initialNavSidebars();

  const parsed: NavSidebarConfig[] = [];
  const seen = new Set<string>();
  for (const entry of raw.sidebars) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id === "" || seen.has(entry.id)) continue;
    seen.add(entry.id);
    parsed.push({
      id: entry.id,
      name: cleanName(entry.name),
      edge: isEdge(entry.edge) ? entry.edge : "left",
      density: isDensity(entry.density) ? entry.density : "full",
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

  return { sidebars, placement };
}

export function createNavSidebar(state: NavSidebarState): NavSidebarState {
  if (state.sidebars.length >= NAV_SIDEBAR_LIMIT) return state;
  const ids = new Set(state.sidebars.map((sidebar) => sidebar.id));
  const id = !ids.has("side-2") ? "side-2" : !ids.has("side-3") ? "side-3" : null;
  if (id === null) return state;
  const used = new Set(state.sidebars.map((sidebar) => sidebar.edge));
  const edge = CREATE_EDGES.find((candidate) => !used.has(candidate)) ?? "right";
  return {
    sidebars: [...state.sidebars, { id, name: id === "side-2" ? "Второй" : "Третий", edge, density: "icons" }],
    placement: state.placement,
  };
}

export function removeNavSidebar(state: NavSidebarState, id: string): NavSidebarState {
  if (id === PRIMARY_SIDEBAR_ID || !state.sidebars.some((sidebar) => sidebar.id === id)) return state;
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

export function movePanelToSidebar(state: NavSidebarState, panelId: string, sidebarId: string): NavSidebarState {
  if (panelId === "" || !state.sidebars.some((sidebar) => sidebar.id === sidebarId)) return state;
  if (sidebarId === PRIMARY_SIDEBAR_ID) {
    if (!(panelId in state.placement)) return state;
    const placement = { ...state.placement };
    delete placement[panelId];
    return { sidebars: state.sidebars, placement };
  }
  if (state.placement[panelId] === sidebarId) return state;
  return { sidebars: state.sidebars, placement: { ...state.placement, [panelId]: sidebarId } };
}

export function panelsForSidebar(state: NavSidebarState, sidebarId: string, panelIds: readonly string[]): string[] {
  if (!state.sidebars.some((sidebar) => sidebar.id === sidebarId)) return [];
  if (sidebarId === PRIMARY_SIDEBAR_ID) {
    return panelIds.filter((panelId) => {
      const placed = state.placement[panelId];
      return placed === undefined || placed === PRIMARY_SIDEBAR_ID;
    });
  }
  return panelIds.filter((panelId) => state.placement[panelId] === sidebarId);
}

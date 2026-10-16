/**
 * A saved Dockview layout is trusted only after it is cleaned: an unknown panel (a removed
 * plugin, a renamed id) used to make `fromJSON` throw and the *whole* workspace layout fell back
 * to the dashboard. Here the unknown panels are dropped instead and everything else is kept;
 * floating groups are pulled back inside the current window so a layout saved on a larger or
 * different screen never opens out of reach. Pure: no Dockview import, no storage, no content.
 */
type Json = Record<string, unknown>;

export interface SanitizedLayout {
  layout: Json;
  removedPanels: string[];
  movedFloating: number;
}

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const MIN_FLOAT = 240;

function cleanGroup(group: Json, keep: (id: string) => boolean, removed: string[]): boolean {
  const views = Array.isArray(group.views) ? group.views.filter((v): v is string => typeof v === "string") : [];
  const kept = views.filter((id) => {
    if (keep(id)) return true;
    removed.push(id);
    return false;
  });
  group.views = kept;
  if (typeof group.activeView !== "string" || !kept.includes(group.activeView)) {
    if (kept.length > 0) group.activeView = kept[0];
    else delete group.activeView;
  }
  return kept.length > 0;
}

/** Returns the leaf group ids that survived, pruning empty leaves and branches in place. */
function cleanNode(node: unknown, keep: (id: string) => boolean, removed: string[], groups: Set<string>): boolean {
  if (!isObject(node)) return false;
  if (node.type === "leaf") {
    if (!isObject(node.data) || !cleanGroup(node.data, keep, removed)) return false;
    if (typeof node.data.id === "string") groups.add(node.data.id);
    return true;
  }
  if (node.type === "branch" && Array.isArray(node.data)) {
    node.data = node.data.filter((child) => cleanNode(child, keep, removed, groups));
    return (node.data as unknown[]).length > 0;
  }
  return false;
}

function clampFloating(position: unknown, view: { width: number; height: number }): boolean {
  if (!isObject(position)) return false;
  const num = (key: string): number | undefined => (typeof position[key] === "number" && Number.isFinite(position[key]) ? (position[key] as number) : undefined);
  const width = Math.min(Math.max(num("width") ?? 480, MIN_FLOAT), view.width);
  const height = Math.min(Math.max(num("height") ?? 360, MIN_FLOAT), view.height);
  const left = Math.min(Math.max(num("left") ?? 40, 0), Math.max(0, view.width - width));
  const top = Math.min(Math.max(num("top") ?? 40, 0), Math.max(0, view.height - height));
  const changed = left !== num("left") || top !== num("top") || width !== num("width") || height !== num("height");
  Object.assign(position, { left, top, width, height });
  delete position.right;
  delete position.bottom;
  return changed;
}

export function sanitizeDockLayout(input: unknown, keep: (panelId: string) => boolean, view: { width: number; height: number }): SanitizedLayout | null {
  if (!isObject(input) || !isObject(input.grid) || !isObject(input.panels)) return null;
  // Work on a copy: the stored value stays as it was until the next save.
  const layout = JSON.parse(JSON.stringify(input)) as Json;
  const grid = layout.grid as Json;
  const removed: string[] = [];
  const groups = new Set<string>();
  if (!cleanNode(grid.root, keep, removed, groups)) return null;

  let movedFloating = 0;
  const floating = Array.isArray(layout.floatingGroups) ? layout.floatingGroups : [];
  layout.floatingGroups = floating.filter((entry) => {
    if (!isObject(entry) || !isObject(entry.data) || !cleanGroup(entry.data, keep, removed)) return false;
    if (typeof entry.data.id === "string") groups.add(entry.data.id);
    if (clampFloating(entry.position, view)) movedFloating += 1;
    return isObject(entry.position);
  });
  // Pop-out groups keep their tabs (only unknown panels are removed); their screen box is left alone.
  if (Array.isArray(layout.popoutGroups)) {
    layout.popoutGroups = layout.popoutGroups.filter((entry) => {
      if (!isObject(entry) || !isObject(entry.data) || !cleanGroup(entry.data, keep, removed)) return false;
      if (typeof entry.data.id === "string") groups.add(entry.data.id);
      return true;
    });
  }

  const panels = layout.panels as Json;
  const alive = new Set<string>();
  const collect = (node: unknown): void => {
    if (!isObject(node)) return;
    if (node.type === "leaf" && isObject(node.data) && Array.isArray(node.data.views)) for (const id of node.data.views) alive.add(String(id));
    else if (Array.isArray(node.data)) node.data.forEach(collect);
  };
  collect(grid.root);
  for (const list of [layout.floatingGroups, layout.popoutGroups]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list as Json[]) if (isObject(entry.data) && Array.isArray(entry.data.views)) for (const id of entry.data.views) alive.add(String(id));
  }
  for (const id of Object.keys(panels)) if (!alive.has(id)) delete panels[id];
  for (const id of alive) if (!isObject(panels[id])) return null;
  if (typeof layout.activeGroup !== "string" || !groups.has(layout.activeGroup)) delete layout.activeGroup;
  return { layout, removedPanels: [...new Set(removed)], movedFloating };
}

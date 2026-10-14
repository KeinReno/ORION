/**
 * Named workbench layouts ("Разработка", "Финансы", "Дом"): a saved arrangement of open
 * panels that can be brought back with one click. Stored per user + workspace in
 * localStorage next to the automatic layout — a layout is a per-viewer convenience, so it
 * never goes to the server and a broken one must never block the app.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const LAYOUT_NAME_MAX = 40;
export const LAYOUT_LIMIT = 12;

export function namedLayoutsKey(userId: string, workspaceId: string): string {
  return `orion.namedLayouts:${userId}:${workspaceId}`;
}

export function cleanLayoutName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, LAYOUT_NAME_MAX);
}

type Store = Record<string, string>;

function read(storage: StorageLike, key: string): Store {
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const store: Store = {};
    for (const [name, value] of Object.entries(parsed)) if (typeof value === "string") store[name] = value;
    return store;
  } catch {
    return {};
  }
}

export function listNamedLayouts(storage: StorageLike, key: string): string[] {
  return Object.keys(read(storage, key)).sort((a, b) => a.localeCompare(b, "ru"));
}

export function getNamedLayout(storage: StorageLike, key: string, name: string): unknown | null {
  const raw = read(storage, key)[name];
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Saves (or overwrites) a layout. `false` = refused: empty name, or the limit is reached for a new name. */
export function saveNamedLayout(storage: StorageLike, key: string, name: string, layout: unknown): boolean {
  const clean = cleanLayoutName(name);
  if (!clean) return false;
  const store = read(storage, key);
  if (!(clean in store) && Object.keys(store).length >= LAYOUT_LIMIT) return false;
  try {
    store[clean] = JSON.stringify(layout);
    storage.setItem(key, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function deleteNamedLayout(storage: StorageLike, key: string, name: string): void {
  const store = read(storage, key);
  if (!(name in store)) return;
  delete store[name];
  try {
    storage.setItem(key, JSON.stringify(store));
    if (getDefaultLayoutName(storage, key) === null) clearDefaultMarker(storage, key);
  } catch {
    /* nothing to do: the layout simply stays */
  }
}

// ---- default layout of a workspace ("открывать при входе") ------------------------------------

/** The default marker lives next to the layouts so the layouts' own storage format is unchanged. */
export function defaultLayoutKey(key: string): string {
  return `${key}:default`;
}

function clearDefaultMarker(storage: StorageLike, key: string): void {
  try {
    storage.setItem(defaultLayoutKey(key), "");
  } catch {
    /* ignore */
  }
}

/** Name of the default layout, or null when none is set or it no longer exists. */
export function getDefaultLayoutName(storage: StorageLike, key: string): string | null {
  try {
    const name = storage.getItem(defaultLayoutKey(key));
    if (!name) return null;
    return name in read(storage, key) ? name : null;
  } catch {
    return null;
  }
}

/** Marks `name` as the default (null clears it). `false` = no such layout / storage refused. */
export function setDefaultLayoutName(storage: StorageLike, key: string, name: string | null): boolean {
  try {
    if (name === null) {
      storage.setItem(defaultLayoutKey(key), "");
      return true;
    }
    if (!(name in read(storage, key))) return false;
    storage.setItem(defaultLayoutKey(key), name);
    return true;
  } catch {
    return false;
  }
}

/** Renames a layout (keeps the default marker). `false` = missing source, empty name or name taken. */
export function renameNamedLayout(storage: StorageLike, key: string, from: string, to: string): boolean {
  const clean = cleanLayoutName(to);
  if (!clean) return false;
  const store = read(storage, key);
  if (!(from in store)) return false;
  if (clean === from) return true;
  if (clean in store) return false;
  const wasDefault = getDefaultLayoutName(storage, key) === from;
  const next: Store = {};
  for (const [name, value] of Object.entries(store)) next[name === from ? clean : name] = value;
  try {
    storage.setItem(key, JSON.stringify(next));
    if (wasDefault) storage.setItem(defaultLayoutKey(key), clean);
    return true;
  } catch {
    return false;
  }
}

// ---- Alt+1..Alt+9 ------------------------------------------------------------------------------

export const LAYOUT_SHORTCUT_COUNT = 9;

/** Index (0..8) of the layout an Alt+digit keypress selects, or null for any other key. */
export function layoutShortcutIndex(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  code: string;
}): number | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
  return match ? Number(match[1]) - 1 : null;
}

// ---- pruning a layout to what exists here --------------------------------------------------------

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Does this look like a dockview `toJSON()` result (a grid tree plus a panels record)? */
export function isDockLayout(value: unknown): value is Json {
  if (!isObject(value) || !isObject(value.panels) || !isObject(value.grid)) return false;
  const root = value.grid.root;
  if (!isObject(root) || (root.type !== "branch" && root.type !== "leaf")) return false;
  return Object.values(value.panels).every((panel) => isObject(panel) && typeof panel.id === "string");
}

/**
 * Drops panels whose component is not known any more (a removed panel) from a dockview layout,
 * together with the groups and branches that become empty. Returns null when nothing is left.
 * Never mutates the input.
 */
export function pruneDockLayout(layout: unknown, isKnownComponent: (component: string) => boolean): Json | null {
  if (!isDockLayout(layout)) return null;
  const panels = layout.panels as Record<string, Json>;
  const alive = new Set<string>();
  const keptPanels: Record<string, Json> = {};
  for (const [id, panel] of Object.entries(panels)) {
    const component = typeof panel.contentComponent === "string" ? panel.contentComponent : id;
    if (isKnownComponent(component)) {
      alive.add(id);
      keptPanels[id] = panel;
    }
  }
  function prune(node: unknown): Json | null {
    if (!isObject(node)) return null;
    if (node.type === "leaf") {
      const data = isObject(node.data) ? node.data : {};
      const views = Array.isArray(data.views) ? data.views.filter((v): v is string => typeof v === "string" && alive.has(v)) : [];
      if (views.length === 0) return null;
      const activeView = typeof data.activeView === "string" && views.includes(data.activeView) ? data.activeView : views[0];
      return { ...node, data: { ...data, views, activeView } };
    }
    if (node.type === "branch" && Array.isArray(node.data)) {
      const children = node.data.map(prune).filter((child): child is Json => child !== null);
      if (children.length === 0) return null;
      return { ...node, data: children };
    }
    return null;
  }
  const grid = layout.grid as Json;
  const root = prune(grid.root);
  if (!root || alive.size === 0) return null;
  const next: Json = { ...layout, grid: { ...grid, root }, panels: keptPanels };
  // The active group may have vanished; dockview then picks one itself.
  delete next.activeGroup;
  return next;
}

// ---- export / import of a workspace's layouts ------------------------------------------------------

export const LAYOUT_EXPORT_FORMAT = "orion-layouts";
export const LAYOUT_EXPORT_VERSION = 1;
/** An import larger than this is refused outright (a layout is a few KB). */
export const LAYOUT_IMPORT_MAX_CHARS = 2_000_000;

/** JSON text with every layout of the workspace and the default marker. Corrupt entries are skipped. */
export function exportNamedLayouts(storage: StorageLike, key: string): string {
  const layouts: Record<string, unknown> = {};
  for (const name of listNamedLayouts(storage, key)) {
    const layout = getNamedLayout(storage, key, name);
    if (isDockLayout(layout)) layouts[name] = layout;
  }
  const def = getDefaultLayoutName(storage, key);
  return JSON.stringify(
    { format: LAYOUT_EXPORT_FORMAT, version: LAYOUT_EXPORT_VERSION, default: def && def in layouts ? def : null, layouts },
    null,
    2
  );
}

export type ParsedLayoutImport =
  | { ok: true; layouts: Record<string, Json>; default: string | null; skipped: number }
  | { ok: false; error: string };

/** Strictly validates pasted/uploaded export text. Never throws. */
export function parseLayoutsImport(text: string): ParsedLayoutImport {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "Пусто: вставьте JSON раскладок." };
  if (text.length > LAYOUT_IMPORT_MAX_CHARS) return { ok: false, error: "Файл слишком большой для набора раскладок." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Это не JSON." };
  }
  if (!isObject(parsed) || parsed.format !== LAYOUT_EXPORT_FORMAT) {
    return { ok: false, error: "Это не экспорт раскладок ORION." };
  }
  if (parsed.version !== LAYOUT_EXPORT_VERSION) return { ok: false, error: "Неизвестная версия формата раскладок." };
  if (!isObject(parsed.layouts)) return { ok: false, error: "В файле нет раскладок." };
  const layouts: Record<string, Json> = {};
  let skipped = 0;
  for (const [rawName, layout] of Object.entries(parsed.layouts)) {
    const name = cleanLayoutName(rawName);
    if (!name || !isDockLayout(layout) || name in layouts) {
      skipped += 1;
      continue;
    }
    layouts[name] = layout;
  }
  if (Object.keys(layouts).length === 0) return { ok: false, error: "В файле нет ни одной корректной раскладки." };
  const def = typeof parsed.default === "string" ? cleanLayoutName(parsed.default) : null;
  return { ok: true, layouts, default: def && def in layouts ? def : null, skipped };
}

export interface LayoutImportResult {
  ok: boolean;
  error?: string;
  added: number;
  replaced: number;
  /** Invalid entries plus those refused by the LAYOUT_LIMIT. */
  skipped: number;
}

/** Merges the layouts from export text into the workspace's store (same name = replaced). */
export function importNamedLayouts(storage: StorageLike, key: string, text: string): LayoutImportResult {
  const parsed = parseLayoutsImport(text);
  if (!parsed.ok) return { ok: false, error: parsed.error, added: 0, replaced: 0, skipped: 0 };
  const store = read(storage, key);
  let added = 0;
  let replaced = 0;
  let skipped = parsed.skipped;
  const accepted: string[] = [];
  for (const [name, layout] of Object.entries(parsed.layouts)) {
    const exists = name in store;
    if (!exists && Object.keys(store).length >= LAYOUT_LIMIT) {
      skipped += 1;
      continue;
    }
    store[name] = JSON.stringify(layout);
    accepted.push(name);
    if (exists) replaced += 1;
    else added += 1;
  }
  try {
    storage.setItem(key, JSON.stringify(store));
    if (parsed.default && accepted.includes(parsed.default)) storage.setItem(defaultLayoutKey(key), parsed.default);
  } catch {
    return { ok: false, error: "Не удалось сохранить раскладки (хранилище недоступно).", added: 0, replaced: 0, skipped };
  }
  return { ok: true, added, replaced, skipped };
}

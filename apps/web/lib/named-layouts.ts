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
  } catch {
    /* nothing to do: the layout simply stays */
  }
}

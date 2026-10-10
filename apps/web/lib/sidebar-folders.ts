import { SIDEBAR_FOLDER_NAME_MAX, SIDEBAR_FOLDERS_MAX, type SidebarFolder } from "@orion/shared-types";

/**
 * The user's own folders in the left sidebar. Pure functions over a plain list so the
 * rules are tested (sidebar-folders.test.ts); the layout only wires them to storage.
 *
 * A folder holds panel ids. A panel is in at most ONE folder — moving it elsewhere takes
 * it out of the first. Ids of panels that are currently hidden (module off, hidden by the
 * user) stay in the folder, so turning the module back on puts it back where it was.
 */

export function normalizeFolders(raw: unknown): SidebarFolder[] {
  if (!Array.isArray(raw)) return [];
  const seenFolders = new Set<string>();
  const seenItems = new Set<string>();
  const out: SidebarFolder[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, name, collapsed, items } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || seenFolders.has(id)) continue;
    const cleanName = cleanFolderName(typeof name === "string" ? name : "");
    if (!cleanName) continue;
    seenFolders.add(id);
    const cleanItems: string[] = [];
    for (const item of Array.isArray(items) ? items : []) {
      if (typeof item !== "string" || item === "" || seenItems.has(item)) continue;
      seenItems.add(item);
      cleanItems.push(item);
    }
    out.push({ id, name: cleanName, collapsed: collapsed === true, items: cleanItems });
    if (out.length >= SIDEBAR_FOLDERS_MAX) break;
  }
  return out;
}

export function cleanFolderName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, SIDEBAR_FOLDER_NAME_MAX);
}

/** Adds a folder (optionally with a first panel). Empty names and a full list are refused (null). */
export function addFolder(folders: readonly SidebarFolder[], name: string, id: string, firstItem?: string): SidebarFolder[] | null {
  const clean = cleanFolderName(name);
  if (!clean || folders.length >= SIDEBAR_FOLDERS_MAX) return null;
  const without = firstItem ? removeItem(folders, firstItem) : [...folders];
  return [...without, { id, name: clean, collapsed: false, items: firstItem ? [firstItem] : [] }];
}

export function renameFolder(folders: readonly SidebarFolder[], id: string, name: string): SidebarFolder[] | null {
  const clean = cleanFolderName(name);
  if (!clean) return null;
  return folders.map((folder) => (folder.id === id ? { ...folder, name: clean } : folder));
}

/** Deleting a folder deletes only the folder: its panels go back to their default place. */
export function deleteFolder(folders: readonly SidebarFolder[], id: string): SidebarFolder[] {
  return folders.filter((folder) => folder.id !== id);
}

function removeItem(folders: readonly SidebarFolder[], panelId: string): SidebarFolder[] {
  return folders.map((folder) => (folder.items.includes(panelId) ? { ...folder, items: folder.items.filter((item) => item !== panelId) } : folder));
}

/** Puts a panel into a folder (appended), or out of every folder when `folderId` is null. */
export function moveToFolder(folders: readonly SidebarFolder[], panelId: string, folderId: string | null): SidebarFolder[] {
  const cleared = removeItem(folders, panelId);
  if (folderId === null) return cleared;
  return cleared.map((folder) => (folder.id === folderId ? { ...folder, items: [...folder.items, panelId] } : folder));
}

export function toggleFolder(folders: readonly SidebarFolder[], id: string): SidebarFolder[] {
  return folders.map((folder) => (folder.id === id ? { ...folder, collapsed: !folder.collapsed } : folder));
}

/** Moves a folder one step up (-1) or down (+1) among the folders; at an end it stays. */
export function moveFolder(folders: readonly SidebarFolder[], id: string, delta: -1 | 1): SidebarFolder[] {
  const index = folders.findIndex((folder) => folder.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= folders.length) return [...folders];
  const next = [...folders];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}

export function folderOf(folders: readonly SidebarFolder[], panelId: string): SidebarFolder | undefined {
  return folders.find((folder) => folder.items.includes(panelId));
}

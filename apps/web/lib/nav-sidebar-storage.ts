/**
 * Sidebar configuration is per person and per workspace, on this computer only.
 * Window geometry is not stored here. A legacy unscoped key is adopted by the
 * first profile that opens it, then removed, so the next account does not inherit it.
 */

import { initialNavSidebars, parseNavSidebarState, type NavSidebarState } from "./sidebar-instances";

export const LEGACY_NAV_SIDEBAR_KEY = "orion.navSidebars.v1";
export const NAV_SIDEBAR_CLAIM_KEY = "orion.navSidebars.v1.claimedBy";

export function navSidebarStorageKey(userId: string, workspaceId: string): string {
  return `orion.navSidebars.v2.${userId}.${workspaceId}`;
}

export interface NavSidebarStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function claimOf(userId: string, workspaceId: string): string {
  return `${userId}\n${workspaceId}`;
}

export function loadNavSidebars(storage: NavSidebarStorage, userId: string, workspaceId: string): NavSidebarState {
  const key = navSidebarStorageKey(userId, workspaceId);
  const own = storage.getItem(key);
  if (own !== null) {
    try {
      return parseNavSidebarState(JSON.parse(own));
    } catch {
      return initialNavSidebars();
    }
  }
  const legacy = storage.getItem(LEGACY_NAV_SIDEBAR_KEY);
  const claim = storage.getItem(NAV_SIDEBAR_CLAIM_KEY);
  if (legacy === null || (claim !== null && claim !== claimOf(userId, workspaceId))) return initialNavSidebars();
  let parsed = initialNavSidebars();
  try {
    parsed = parseNavSidebarState(JSON.parse(legacy));
  } catch {
    parsed = initialNavSidebars();
  }
  storage.setItem(key, JSON.stringify(parsed));
  storage.setItem(NAV_SIDEBAR_CLAIM_KEY, claimOf(userId, workspaceId));
  storage.removeItem(LEGACY_NAV_SIDEBAR_KEY);
  return parsed;
}

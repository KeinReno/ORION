"use client";

import { useCallback, useEffect, useState } from "react";
import { loadNavSidebars, navSidebarStorageKey } from "./nav-sidebar-storage";
import { initialNavSidebars, parseNavSidebarState, type NavSidebarState } from "./sidebar-instances";

/**
 * Which navigation bars exist for this person in this workspace.
 * Saved on this computer only. Another window of the same pair hears the change.
 */
export function useNavSidebars(userId: string | undefined, workspaceId: string | undefined): {
  state: NavSidebarState;
  update: (updater: (current: NavSidebarState) => NavSidebarState) => void;
} {
  const scope = userId && workspaceId ? navSidebarStorageKey(userId, workspaceId) : null;
  const [state, setState] = useState<NavSidebarState>(initialNavSidebars);
  const [readyScope, setReadyScope] = useState<string | null>(null);

  useEffect(() => {
    if (!scope || !userId || !workspaceId) return;
    setState(loadNavSidebars(window.localStorage, userId, workspaceId));
    setReadyScope(scope);
  }, [scope, userId, workspaceId]);

  useEffect(() => {
    if (!scope || readyScope !== scope) return;
    try {
      const next = JSON.stringify(state);
      if (window.localStorage.getItem(scope) === next) return;
      window.localStorage.setItem(scope, next);
    } catch {
      // A blocked or full store keeps the bars for this visit.
    }
  }, [readyScope, scope, state]);

  useEffect(() => {
    if (!scope) return;
    function onStorage(event: StorageEvent): void {
      if (event.key !== scope || event.newValue === null) return;
      try {
        const parsed = parseNavSidebarState(JSON.parse(event.newValue));
        setState((current) => (JSON.stringify(current) === event.newValue ? current : parsed));
      } catch {
        setState(initialNavSidebars());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [scope]);

  const update = useCallback((updater: (current: NavSidebarState) => NavSidebarState) => {
    setState((current) => updater(current));
  }, []);

  return { state, update };
}

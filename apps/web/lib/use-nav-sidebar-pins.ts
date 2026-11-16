"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadNavSidebarPins,
  navSidebarPinned,
  navSidebarPinsStorageKey,
  parseNavSidebarPins,
  saveNavSidebarPins,
  withNavSidebarPin,
  type NavSidebarPins
} from "./nav-sidebar-pins";

/**
 * Which navigation bars are pinned (expanded) for this person in this
 * workspace. Saved on this computer only; another window of the same pair
 * hears the change through the `storage` event, so pinning in one window
 * expands the bar in every other window of the same session.
 */
export function useNavSidebarPins(userId: string | undefined, workspaceId: string | undefined): {
  pins: NavSidebarPins;
  pinned: (sidebarId: string, defaultValue?: boolean) => boolean;
  setPinned: (sidebarId: string, pinned: boolean) => void;
} {
  const scope = userId && workspaceId ? navSidebarPinsStorageKey(userId, workspaceId) : null;
  const [pins, setPins] = useState<NavSidebarPins>({});
  const [readyScope, setReadyScope] = useState<string | null>(null);

  useEffect(() => {
    if (!scope || !userId || !workspaceId) return;
    setPins(loadNavSidebarPins(window.localStorage, userId, workspaceId));
    setReadyScope(scope);
  }, [scope, userId, workspaceId]);

  useEffect(() => {
    if (!scope || readyScope !== scope) return;
    if (!userId || !workspaceId) return;
    saveNavSidebarPins(window.localStorage, userId, workspaceId, pins);
  }, [readyScope, scope, pins, userId, workspaceId]);

  useEffect(() => {
    if (!scope) return;
    function onStorage(event: StorageEvent): void {
      if (event.key !== scope || event.newValue === null) return;
      try {
        const parsed = parseNavSidebarPins(JSON.parse(event.newValue));
        setPins((current) => (JSON.stringify(current) === event.newValue ? current : parsed));
      } catch {
        setPins({});
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [scope]);

  const pinned = useCallback(
    (sidebarId: string, defaultValue = true) => navSidebarPinned(pins, sidebarId, defaultValue),
    [pins]
  );
  const setPinned = useCallback((sidebarId: string, pinnedValue: boolean) => {
    setPins((current) => withNavSidebarPin(current, sidebarId, pinnedValue));
  }, []);

  return { pins, pinned, setPinned };
}

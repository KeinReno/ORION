"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { initialNavSidebars, parseNavSidebarState, type NavSidebarState } from "./sidebar-instances";

const STORAGE_KEY = "orion.navSidebars.v1";

function readStoredNavSidebars(): NavSidebarState {
  if (typeof window === "undefined") return initialNavSidebars();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return initialNavSidebars();
    return parseNavSidebarState(JSON.parse(raw));
  } catch {
    // Missing or corrupt JSON keeps the single primary bar.
    return initialNavSidebars();
  }
}

/**
 * Which navigation bars exist, and which panel sits on which bar.
 * Saved on this computer only — placement never enables or disables a module.
 */
export function useNavSidebars(): {
  state: NavSidebarState;
  update: (updater: (current: NavSidebarState) => NavSidebarState) => void;
} {
  const [state, setState] = useState<NavSidebarState>(initialNavSidebars);
  const [ready, setReady] = useState(false);
  const untouched = useRef(state);

  useEffect(() => {
    setState((current) => (current === untouched.current ? readStoredNavSidebars() : current));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // A blocked or full store keeps the bars for this visit.
    }
  }, [ready, state]);

  const update = useCallback((updater: (current: NavSidebarState) => NavSidebarState) => {
    setState((current) => updater(current));
  }, []);

  return { state, update };
}

"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * ORION-11 — a second, independent dock (its own `DockviewApi`, own saved
 * layout under `dockLayoutStorageKey(..., "secondary")`) that can sit beside
 * the main Workbench or be pulled out into its own OS window on a second
 * monitor. This module only owns the UI-chrome state — whether it's open, on
 * which side, how wide, and (cross-window) whether it currently lives in a
 * detached window instead of docked here. The dock's actual panel layout is
 * dockview's own `toJSON`/`fromJSON`, same mechanism the primary Workbench
 * already uses — this never touches that.
 *
 * Deliberately NOT keyed by workspace: which side the second sidebar sits on
 * and whether it's pulled out is a property of this window's chrome, like
 * `compact`/`precision`, not of the workspace open inside it.
 */
export type SecondaryDockPosition = "left" | "right";

export interface SecondaryDockPrefs {
  open: boolean;
  position: SecondaryDockPosition;
  width: number;
}

const DEFAULT_PREFS: SecondaryDockPrefs = { open: false, position: "right", width: 380 };
const STORAGE_KEY = "orion.secondaryDock.prefs";
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;

function readPrefs(): SecondaryDockPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<SecondaryDockPrefs>;
    return {
      open: typeof parsed.open === "boolean" ? parsed.open : DEFAULT_PREFS.open,
      position: parsed.position === "left" || parsed.position === "right" ? parsed.position : DEFAULT_PREFS.position,
      width: typeof parsed.width === "number" && parsed.width >= MIN_WIDTH && parsed.width <= MAX_WIDTH ? parsed.width : DEFAULT_PREFS.width
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(prefs: SecondaryDockPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* a lost preference just falls back to the default next load */
  }
}

const prefsListeners = new Set<() => void>();
let prefs: SecondaryDockPrefs | null = null;

function getPrefs(): SecondaryDockPrefs {
  if (!prefs) prefs = readPrefs();
  return prefs;
}

function setPrefs(next: SecondaryDockPrefs): void {
  prefs = next;
  writePrefs(next);
  for (const listener of prefsListeners) listener();
}

export function isSecondaryDockOpen(): boolean {
  return getPrefs().open;
}

export function setSecondaryDockOpen(open: boolean): void {
  setPrefs({ ...getPrefs(), open });
}

export function toggleSecondaryDock(): void {
  setSecondaryDockOpen(!isSecondaryDockOpen());
}

export function setSecondaryDockPosition(position: SecondaryDockPosition): void {
  setPrefs({ ...getPrefs(), position });
}

export function setSecondaryDockWidth(width: number): void {
  setPrefs({ ...getPrefs(), width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width))) });
}

/**
 * Cross-window "who currently has the dock docked vs. detached" — see
 * `secondary-dock-window.ts` for the detach/redock actions that drive this.
 * Kept out of `localStorage`/the prefs above on purpose: it is per-process
 * truth about which window currently renders the dock, not a saved
 * preference, and a stale `true` surviving a crashed detached window would
 * otherwise strand the main window with no way back in short of clearing
 * storage by hand.
 */
let detachedElsewhere = false;
const detachedListeners = new Set<() => void>();

export function isSecondaryDockDetachedElsewhere(): boolean {
  return detachedElsewhere;
}

export function setSecondaryDockDetachedElsewhere(value: boolean): void {
  if (detachedElsewhere === value) return;
  detachedElsewhere = value;
  for (const listener of detachedListeners) listener();
}

function subscribePrefs(listener: () => void): () => void {
  prefsListeners.add(listener);
  return () => prefsListeners.delete(listener);
}

function subscribeDetached(listener: () => void): () => void {
  detachedListeners.add(listener);
  return () => detachedListeners.delete(listener);
}

export interface SecondaryDock extends SecondaryDockPrefs {
  detachedElsewhere: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setPosition: (position: SecondaryDockPosition) => void;
  setWidth: (width: number) => void;
}

/** React-facing combination of the persisted prefs and the cross-window detached flag. */
export function useSecondaryDock(): SecondaryDock {
  const current = useSyncExternalStore(subscribePrefs, getPrefs, () => DEFAULT_PREFS);
  const detached = useSyncExternalStore(subscribeDetached, isSecondaryDockDetachedElsewhere, () => false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return {
    ...(mounted ? current : DEFAULT_PREFS),
    detachedElsewhere: mounted ? detached : false,
    setOpen: setSecondaryDockOpen,
    toggle: toggleSecondaryDock,
    setPosition: setSecondaryDockPosition,
    setWidth: setSecondaryDockWidth
  };
}

/**
 * The tab-strip "move to the other dock" buttons (`MoveToSecondaryHeaderAction`/
 * `MoveToPrimaryHeaderAction` in `app/(app)/layout.tsx`) are module-scope
 * components, same as every other `IDockviewHeaderActionsProps` component in
 * that file (`DetachHeaderAction`, `FloatHeaderAction`) — they can't close
 * over the layout component's own `apiRef`/`secondaryApiRef`. This mirrors
 * `panel-bus.ts`'s `registerPanelBus`: the layout registers its real
 * close-here/open-there implementation once mounted, the header actions
 * just call the exported function.
 */
interface SecondaryDockMove {
  toSecondary: (panelId: string) => void;
  toPrimary: (panelId: string) => void;
}
let move: SecondaryDockMove | null = null;

export function registerSecondaryDockMove(impl: SecondaryDockMove): () => void {
  move = impl;
  return () => {
    if (move === impl) move = null;
  };
}

export function moveToSecondaryDock(panelId: string): void {
  move?.toSecondary(panelId);
}

export function moveToPrimaryDock(panelId: string): void {
  move?.toPrimary(panelId);
}

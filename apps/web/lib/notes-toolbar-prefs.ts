"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * ORION-06 — where the formatting rail sits and whether it's shown at all. Pure view chrome
 * (like `secondary-dock.ts`'s position/open prefs) — localStorage, not a synced `UserPreference`
 * column: nobody needs this to follow them to a second device the way theme/accent do.
 */
export type NotesToolbarSide = "left" | "right";

export interface NotesToolbarPrefs {
  side: NotesToolbarSide;
  hidden: boolean;
}

const DEFAULT_PREFS: NotesToolbarPrefs = { side: "left", hidden: false };
const STORAGE_KEY = "orion.notesToolbar.prefs";

function readPrefs(): NotesToolbarPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<NotesToolbarPrefs>;
    return {
      side: parsed.side === "left" || parsed.side === "right" ? parsed.side : DEFAULT_PREFS.side,
      hidden: typeof parsed.hidden === "boolean" ? parsed.hidden : DEFAULT_PREFS.hidden
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(prefs: NotesToolbarPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* a lost preference just falls back to the default next load */
  }
}

let prefs: NotesToolbarPrefs | null = null;
const listeners = new Set<() => void>();

function getPrefs(): NotesToolbarPrefs {
  if (!prefs) prefs = readPrefs();
  return prefs;
}

function setPrefs(next: NotesToolbarPrefs): void {
  prefs = next;
  writePrefs(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface NotesToolbarControls extends NotesToolbarPrefs {
  setSide: (side: NotesToolbarSide) => void;
  toggleHidden: () => void;
}

export function useNotesToolbarPrefs(): NotesToolbarControls {
  const current = useSyncExternalStore(subscribe, getPrefs, () => DEFAULT_PREFS);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const value = mounted ? current : DEFAULT_PREFS;
  return {
    ...value,
    setSide: (side) => setPrefs({ ...getPrefs(), side }),
    toggleHidden: () => setPrefs({ ...getPrefs(), hidden: !getPrefs().hidden })
  };
}

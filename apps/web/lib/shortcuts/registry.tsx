"use client";

import { isTypingTarget } from "@orion/ui";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { comboMatchesEvent } from "./combo";
import { effectiveCombo, getShortcutDef, SHORTCUT_CATALOG } from "./catalog";

/**
 * ORION-06 — Shortcut Manager runtime. Two different dispatch paths, deliberately:
 *
 * - `scope: "global"` entries (the command palette, …) have no natural DOM owner — they must fire
 *   from anywhere, so `GlobalShortcutDispatcher` is the one `keydown` listener for all of them,
 *   mounted once near the app root, and `useShortcutHandler` registers what runs when one fires.
 * - `scope: "notes-editor"` entries already have a natural owner: CodeMirror only sees a keydown
 *   when ITS OWN view has focus, which already scopes "only act in the currently focused editor"
 *   for free, correctly even with several Notes editors mounted at once (ORION-11's second dock).
 *   Reinventing that with a second global listener would have to re-solve "which of N open editors
 *   is the right target" by hand — so these never go through this dispatcher: the editor instead
 *   reads the live combo with `useShortcutCombo(id)` and builds its own keymap from it (see
 *   `markdown-editor.tsx`'s `Compartment` usage). `findShortcutConflicts` (catalog.ts) still checks
 *   these the same way — it is data-level, independent of how each scope actually dispatches.
 */

const ShortcutsContext = createContext<Readonly<Record<string, string>>>({});

export function ShortcutsProvider({ overrides, children }: { overrides: Readonly<Record<string, string>>; children: ReactNode }): React.ReactElement {
  return <ShortcutsContext.Provider value={overrides}>{children}</ShortcutsContext.Provider>;
}

export function useShortcutOverrides(): Readonly<Record<string, string>> {
  return useContext(ShortcutsContext);
}

/** The live, rebind-aware combo for one catalog entry — read this instead of hardcoding a key string. */
export function useShortcutCombo(id: string): string {
  const overrides = useShortcutOverrides();
  return useMemo(() => {
    const def = getShortcutDef(id);
    return def ? effectiveCombo(def, overrides) : "";
  }, [id, overrides]);
}

/** Same as `useShortcutCombo`, for several ids at once — one subscription instead of N. */
export function useShortcutCombos<T extends string>(ids: readonly T[]): Record<T, string> {
  const overrides = useShortcutOverrides();
  return useMemo(() => {
    const entries = ids.map((id) => {
      const def = getShortcutDef(id);
      return [id, def ? effectiveCombo(def, overrides) : ""] as const;
    });
    return Object.fromEntries(entries) as Record<T, string>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join("|"), overrides]);
}

const globalHandlers = new Map<string, (event: KeyboardEvent) => void>();

/** Only for `scope: "global"` catalog entries — see the module doc above for why scoped ones don't use this. */
export function useShortcutHandler(id: string, handler: (event: KeyboardEvent) => void): void {
  const savedHandler = useRef(handler);
  savedHandler.current = handler;
  useEffect(() => {
    if (getShortcutDef(id)?.scope !== "global") {
      console.warn(`useShortcutHandler("${id}"): это не global-команда — её должен диспетчеризовать владелец скоупа, не общий слушатель.`);
    }
    const wrapped = (event: KeyboardEvent) => savedHandler.current(event);
    globalHandlers.set(id, wrapped);
    return () => {
      if (globalHandlers.get(id) === wrapped) globalHandlers.delete(id);
    };
  }, [id]);
}

/** Mounted once near the app root — the single `keydown` listener for every `scope: "global"` entry. */
export function GlobalShortcutDispatcher(): null {
  const overrides = useShortcutOverrides();
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      for (const def of SHORTCUT_CATALOG) {
        if (def.scope !== "global") continue;
        if (!def.allowInInput && isTypingTarget(event.target)) continue;
        const combo = effectiveCombo(def, overrides);
        if (combo === "" || !comboMatchesEvent(combo, event)) continue;
        const handler = globalHandlers.get(def.id);
        if (!handler) continue;
        event.preventDefault();
        handler(event);
        return;
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [overrides]);
  return null;
}

"use client";

import { isTypingTarget } from "@orion/ui";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { advanceSequence, comboMatchesEvent, parseCombo, type SequenceStep } from "./combo";
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
 * Sequences ("g+d") are also global: the first plain key arms a prefix, the second fires.
 * The shell shows that wait via `orion:goto-sequence`.
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

const SEQUENCE_TIMEOUT_MS = 800;

function shellSequences(overrides: Readonly<Record<string, string>>): SequenceStep[] {
  const steps: SequenceStep[] = [];
  for (const def of SHORTCUT_CATALOG) {
    if (def.scope !== "global") continue;
    const parsed = parseCombo(effectiveCombo(def, overrides));
    if (!("stages" in parsed) || parsed.stages.length < 2) continue;
    steps.push({ id: def.id, stages: parsed.stages });
  }
  return steps;
}

function setSequenceArmed(armed: boolean): void {
  window.dispatchEvent(new CustomEvent("orion:goto-sequence", { detail: { armed } }));
}

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

/** Several global handlers in one effect — a loop of `useShortcutHandler` would break the rules of hooks. */
export function useShortcutHandlers(handlers: Readonly<Record<string, (event: KeyboardEvent) => void>>): void {
  const saved = useRef(handlers);
  saved.current = handlers;
  const ids = Object.keys(handlers).sort().join("|");
  useEffect(() => {
    const wrapped = new Map<string, (event: KeyboardEvent) => void>();
    for (const id of ids === "" ? [] : ids.split("|")) {
      if (getShortcutDef(id)?.scope !== "global") {
        console.warn(`useShortcutHandler("${id}"): это не global-команда — её должен диспетчеризовать владелец скоупа, не общий слушатель.`);
      }
      const fn = (event: KeyboardEvent) => saved.current[id]?.(event);
      wrapped.set(id, fn);
      globalHandlers.set(id, fn);
    }
    return () => {
      for (const [id, fn] of wrapped) {
        if (globalHandlers.get(id) === fn) globalHandlers.delete(id);
      }
    };
  }, [ids]);
}

/** Mounted once near the app root — the single `keydown` listener for every `scope: "global"` entry. */
export function GlobalShortcutDispatcher(): null {
  const overrides = useShortcutOverrides();
  const pending = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function disarm(): void {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (pending.current.length > 0) setSequenceArmed(false);
      pending.current = [];
    }
    function onKeyDown(event: KeyboardEvent): void {
      const typing = isTypingTarget(event.target);
      const plain = !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.key.length === 1;
      if (plain && !typing) {
        const step = advanceSequence(pending.current, event.key.toLowerCase(), shellSequences(overrides));
        if (step.kind === "fire") {
          event.preventDefault();
          disarm();
          globalHandlers.get(step.id)?.(event);
          return;
        }
        if (step.kind === "prefix") {
          event.preventDefault();
          pending.current = step.pending;
          setSequenceArmed(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(disarm, SEQUENCE_TIMEOUT_MS);
          return;
        }
        if (pending.current.length > 0) disarm();
      } else if (pending.current.length > 0) {
        disarm();
      }

      for (const def of SHORTCUT_CATALOG) {
        if (def.scope !== "global") continue;
        if (!def.allowInInput && typing) continue;
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
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      disarm();
    };
  }, [overrides]);
  return null;
}

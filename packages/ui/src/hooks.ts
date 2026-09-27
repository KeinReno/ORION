"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* eslint-disable react-hooks/exhaustive-deps */

/**
 * Tracks the pixel width of an element via ResizeObserver. Panels live
 * inside a dockview dock and can be resized to any width independently of
 * the viewport, so `@media` breakpoints don't help — a master/detail panel
 * has to react to its own box, not the window.
 *
 * Inactive dockview tabs are `display: none` and report width 0. Treating
 * that as a real shrink flips Notes/Documents from two-pane into a portaled
 * Sheet on top of whichever panel the user just opened — so 0 is ignored
 * and the last visible width is kept.
 */
export function useResizeWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const apply = (next: number): void => {
      if (next <= 0) return;
      setWidth(next);
    };
    apply(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/** Calls `handler` on a pointerdown / touchstart outside any of the refs. */
export function useOnClickOutside(
  refs: React.RefObject<HTMLElement | null> | React.RefObject<HTMLElement | null>[],
  handler: () => void,
  enabled = true
): void {
  const savedHandler = useRef(handler);
  savedHandler.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const list = Array.isArray(refs) ? refs : [refs];
    function onDown(event: Event): void {
      const target = event.target as Node | null;
      if (!target) return;
      for (const ref of list) {
        if (ref.current && ref.current.contains(target)) return;
      }
      savedHandler.current();
    }
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("touchstart", onDown, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("touchstart", onDown, true);
    };
  }, [enabled]);
}

/** Fires `handler` on the Escape key while `enabled`. */
export function useEscapeKey(handler: () => void, enabled = true): void {
  const savedHandler = useRef(handler);
  savedHandler.current = handler;

  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") savedHandler.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/**
 * Returns `value`, but only after it's stopped changing for `delayMs` —
 * for feeding a search box into a server request without firing one per
 * keystroke (see TasksPanel/NotesPanel, which debounce into `useTasks`/
 * `useNotes`'s server-side full-text search).
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** True only after the first client render — gate portals / `document` access. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/**
 * Viewport media query. SSR and the first client render are `false` so
 * hydration matches; the real value lands in an effect.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (): void => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** True when the event is coming from a field that should keep its own keys. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(el.isContentEditable);
}

/**
 * Registers a global hotkey. `combo` is like "mod+k" (mod = ⌘ on macOS,
 * Ctrl elsewhere) or "mod+shift+n". Ignores keystrokes typed into inputs
 * unless `allowInInput` is set.
 */
export function useHotkey(combo: string, handler: (event: KeyboardEvent) => void, allowInInput = false): void {
  const savedHandler = useRef(handler);
  savedHandler.current = handler;

  const matches = useCallback(
    (event: KeyboardEvent): boolean => {
      const parts = combo.toLowerCase().split("+");
      const key = parts[parts.length - 1];
      const needMod = parts.includes("mod");
      const needShift = parts.includes("shift");
      const needAlt = parts.includes("alt");
      const mod = event.metaKey || event.ctrlKey;
      if (needMod !== mod) return false;
      if (needShift !== event.shiftKey) return false;
      if (needAlt !== event.altKey) return false;
      return event.key.toLowerCase() === key;
    },
    [combo]
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!allowInInput && isTypingTarget(event.target)) return;
      if (matches(event)) savedHandler.current(event);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [matches, allowInInput]);
}

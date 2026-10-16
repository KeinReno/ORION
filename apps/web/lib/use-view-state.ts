"use client";

import { useEffect, useRef } from "react";
import { useSession } from "@orion/core-react";
import { readViewState, viewStateKey, writeViewState, type ViewStateSchema } from "@orion/shared-types";

/**
 * Restores a panel's saved view state once (when user and workspace are known) via `apply`, then
 * saves `snapshot` whenever it changes. Saving starts only after the restore attempt so the initial
 * defaults never overwrite what was saved. Returns the restored state (or null) for callers that
 * must check restored object ids once their data has loaded.
 */
export function useViewState<T>(panelId: string, schema: ViewStateSchema<T>, workspaceId: string | undefined, snapshot: T, apply: (state: T) => void): T | null {
  const { user } = useSession();
  const userId = user?.id;
  const restored = useRef<{ key: string; state: T | null } | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const key = userId && workspaceId ? viewStateKey(userId, workspaceId) : null;

  useEffect(() => {
    if (!key) return;
    if (restored.current?.key === key) return;
    let state: T | null = null;
    try { state = readViewState(window.localStorage, key, panelId, schema); } catch { /* storage unavailable */ }
    restored.current = { key, state };
    if (state) applyRef.current(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, panelId]);

  const serialized = JSON.stringify(snapshot);
  useEffect(() => {
    if (!key || restored.current?.key !== key) return;
    const timer = window.setTimeout(() => {
      try { writeViewState(window.localStorage, key, panelId, schema, JSON.parse(serialized) as T); } catch { /* ignore */ }
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, panelId, serialized]);

  return restored.current?.key === key ? restored.current.state : null;
}

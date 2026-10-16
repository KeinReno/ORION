"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createObjectContextStore, type PanelObjectContext } from "./object-context-store";

export type { PanelObjectContext } from "./object-context-store";
const store = createObjectContextStore();
const Scope = createContext<string | null>(null);

export function ObjectContextScope({ panelId, children }: { panelId: string; children?: ReactNode }): React.ReactElement {
  return createElement(Scope.Provider, { value: panelId }, children);
}

export function useObjectContext(workspaceId: string | undefined, panelId: string | null): PanelObjectContext | null {
  const snapshot = useCallback(() => workspaceId && panelId ? store.get(workspaceId, panelId) : null, [workspaceId, panelId]);
  return useSyncExternalStore(store.subscribe, snapshot, () => null);
}

/** A module publishes only its own editor; no global active-object mutable pointer. */
export function usePublishObjectContext(record: Omit<PanelObjectContext, "panelId">): void {
  const panelId = useContext(Scope);
  const { workspaceId, entityType, entityId, title, saveState, hasPendingChanges } = record;
  useEffect(() => {
    if (!panelId || !workspaceId) return;
    return store.publish({ panelId, workspaceId, entityType, entityId, title, saveState, hasPendingChanges });
  }, [panelId, workspaceId, entityType, entityId, title, saveState, hasPendingChanges]);
}

/** Read at the time of navigation, rather than closing over a stale render. */
export function useCanLeaveObject(workspaceId: string | undefined): (nextEntityId?: string | null) => boolean {
  const panelId = useContext(Scope);
  return useCallback((nextEntityId?: string | null) => {
    const current = workspaceId && panelId ? store.get(workspaceId, panelId) : null;
    return !current?.hasPendingChanges || current.entityId === nextEntityId;
  }, [workspaceId, panelId]);
}

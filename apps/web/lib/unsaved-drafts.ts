"use client";

import { createContext, createElement, useContext, useEffect, useId, useSyncExternalStore, type ReactNode } from "react";
import { setActiveWorkspaceId } from "./use-active-workspace";

/**
 * Text a person has typed but nothing has saved yet (a thought in the capture box, a new note not
 * created yet, a comment, an unsent task form, or an autosave still in flight).
 * Switching workspace or closing the owning dock tab would discard it.
 */

const DraftPanelContext = createContext<string | null>(null);
const dirtyIds = new Map<string, string | null>();
let pendingSwitch: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The dock panel id the calling component renders in (null outside a dock panel, e.g. a detached window). */
export function usePanelId(): string | null {
  return useContext(DraftPanelContext);
}

/** Marks `id` as holding unsaved text; returns the function that clears it. */
export function PanelDraftScope({ panelId, children }: { panelId: string; children?: ReactNode }): React.ReactElement {
  return createElement(DraftPanelContext.Provider, { value: panelId }, children);
}

export function registerDraft(id: string, panelId: string | null = null): () => void {
  dirtyIds.set(id, panelId);
  return () => {
    dirtyIds.delete(id);
  };
}

/** A mounted field reports whether it holds unsaved text. */
export function useUnsavedDraft(dirty: boolean): void {
  const id = useId();
  const panelId = useContext(DraftPanelContext);
  useEffect(() => {
    if (!dirty) return;
    return registerDraft(id, panelId);
  }, [dirty, id, panelId]);
}

export function hasUnsavedDrafts(panelId?: string): boolean {
  return panelId === undefined ? dirtyIds.size > 0 : [...dirtyIds.values()].includes(panelId);
}

/** Switches workspace now when nothing is unsaved; otherwise parks the request for the confirm dialog. */
export function requestWorkspaceSwitch(workspaceId: string): void {
  if (!hasUnsavedDrafts()) {
    setActiveWorkspaceId(workspaceId);
    return;
  }
  pendingSwitch = workspaceId;
  emit();
}

export function confirmPendingSwitch(): void {
  const target = pendingSwitch;
  pendingSwitch = null;
  dirtyIds.clear();
  emit();
  if (target) setActiveWorkspaceId(target);
}

export function cancelPendingSwitch(): void {
  pendingSwitch = null;
  emit();
}

/** The workspace id waiting for confirmation, or null. */
export function usePendingSwitch(): string | null {
  return useSyncExternalStore(subscribe, () => pendingSwitch, () => null);
}

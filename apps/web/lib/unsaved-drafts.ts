"use client";

import { useEffect, useId, useSyncExternalStore } from "react";
import { setActiveWorkspaceId } from "./use-active-workspace";

/**
 * Text a person has typed but nothing has saved yet (a thought in the capture box, a new note not
 * created yet, a comment, an unsent task form). Switching workspace remounts the panels and that
 * text would silently vanish, so the switch asks first. Things that autosave (an open note, the task
 * detail pane) are not drafts: they flush on their own.
 */

const dirtyIds = new Set<string>();
let pendingSwitch: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Marks `id` as holding unsaved text; returns the function that clears it. */
export function registerDraft(id: string): () => void {
  dirtyIds.add(id);
  return () => {
    dirtyIds.delete(id);
  };
}

/** A mounted field reports whether it holds unsaved text. */
export function useUnsavedDraft(dirty: boolean): void {
  const id = useId();
  useEffect(() => {
    if (!dirty) return;
    return registerDraft(id);
  }, [dirty, id]);
}

export function hasUnsavedDrafts(): boolean {
  return dirtyIds.size > 0;
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

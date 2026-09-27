import { useWorkspaces } from "@orion/core-react";
import type { Workspace } from "@orion/shared-types";
import { useSyncExternalStore } from "react";
import { getWindowId } from "./window-context";

/**
 * U04 (24-CONNECTED-CORE-BACKLOG.md) — the chosen workspace used to live
 * under a single global `localStorage` key (`orion:active-workspace-id`),
 * shared by EVERY tab/window on this origin. Two windows switching to
 * different workspaces stomped on each other's choice, and a reload of
 * either one picked up whichever write happened last — confirmed as a real
 * gap in 12-PROGRESS.md's U00 entry, not a hypothetical.
 *
 * Fix: key the stored value by `windowId` (`window-context.ts`) AND move it
 * to `sessionStorage`. `sessionStorage` is natively per-browsing-context, so
 * this isn't just "a longer key in the same shared bucket" — a reload of the
 * SAME tab still reads its own value (survives reload, per the U04 done
 * criterion), while a genuinely new tab/window starts with nothing and falls
 * through to the existing "no silent fallback to workspaces[0]" behavior
 * (redirect to `/spaces`) exactly as before. The `windowId` component keeps
 * the key self-describing and gives other code (dock-layout-key.ts, future
 * per-window UI) a stable value to key by instead of re-deriving one.
 *
 * Same-tab updates still go through the subscriber set below — the native
 * `storage` event only fires in *other* tabs, and now doesn't apply here at
 * all (`sessionStorage` writes don't fire cross-tab `storage` events even
 * for same-key names, since each tab has its own area).
 */
const listeners = new Set<() => void>();

/** Pure: the sessionStorage key a given window's active-workspace choice lives under. */
export function activeWorkspaceStorageKey(windowId: string): string {
  return `orion:active-workspace:${windowId}`;
}

function getStoredId(): string | null {
  try {
    return sessionStorage.getItem(activeWorkspaceStorageKey(getWindowId()));
  } catch {
    return null;
  }
}

/**
 * Synchronous read of the chosen workspace id, for code outside React that
 * needs to scope something to "whatever workspace is active right now, in
 * THIS window" without waiting for a render — see `panel-bus.ts`'s
 * pending-intent workspace scoping (S09): an intent stamped with the
 * workspace id at emit time must compare against this same source at
 * consume time, or a switch mid-flight (emit in W1, mount happens after the
 * user picks W2) would let a stale intent leak into the wrong workspace.
 * Because this is now `sessionStorage`-backed, that scoping is also
 * automatically per-window: an intent emitted in one tab can never be
 * consumed in another tab's mount, even if both happened to pick the same
 * workspace id.
 */
export const getActiveWorkspaceId = getStoredId;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setActiveWorkspaceId(id: string): void {
  try {
    sessionStorage.setItem(activeWorkspaceStorageKey(getWindowId()), id);
  } catch {
    // Private mode / storage disabled — the switch just won't survive a reload.
  }
  for (const listener of listeners) listener();
}

export function useActiveWorkspace(): {
  workspace: Workspace | undefined;
  workspaces: Workspace[];
  isLoading: boolean;
} {
  const { data, isLoading } = useWorkspaces();
  const storedId = useSyncExternalStore(subscribe, getStoredId, () => null);
  const workspaces = data ?? [];
  const workspace = storedId ? workspaces.find((w) => w.id === storedId) : undefined;
  return { workspace, workspaces, isLoading };
}

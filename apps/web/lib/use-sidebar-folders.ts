"use client";

import { usePreferences, useUpdatePreferences } from "@orion/core-react";
import type { SidebarFolder, UserPreference } from "@orion/shared-types";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { normalizeFolders } from "./sidebar-folders";

/** An id that is unique enough for a handful of personal folders and needs no server round trip. */
export function newFolderId(): string {
  return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The user's sidebar folders from their saved preferences, and a saver. The change shows
 * at once (the cached preferences are updated first) and is then written to the server; if
 * the write fails the cache is refetched, so the screen returns to what is really stored.
 */
export function useSidebarFolders(): {
  folders: SidebarFolder[];
  save: (next: SidebarFolder[]) => void;
  order: string[];
  saveOrder: (next: string[]) => void;
} {
  const { data } = usePreferences();
  const update = useUpdatePreferences();
  const queryClient = useQueryClient();
  const stored = data?.sidebarFolders;
  const folders = useMemo(() => normalizeFolders(stored), [stored]);
  const save = useCallback(
    (next: SidebarFolder[]) => {
      queryClient.setQueryData<UserPreference>(["preferences"], (current) => (current ? { ...current, sidebarFolders: next } : current));
      update.mutate(
        { sidebarFolders: next },
        { onError: () => void queryClient.invalidateQueries({ queryKey: ["preferences"] }) }
      );
    },
    [queryClient, update]
  );
  const order = useMemo(() => (Array.isArray(data?.sidebarOrder) ? data.sidebarOrder : []), [data?.sidebarOrder]);
  const saveOrder = useCallback(
    (next: string[]) => {
      queryClient.setQueryData<UserPreference>(["preferences"], (current) => (current ? { ...current, sidebarOrder: next } : current));
      update.mutate({ sidebarOrder: next }, { onError: () => void queryClient.invalidateQueries({ queryKey: ["preferences"] }) });
    },
    [queryClient, update]
  );
  return { folders, save, order, saveOrder };
}

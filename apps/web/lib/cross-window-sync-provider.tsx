"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { SYNC_CHANNEL, connectCacheSync } from "./cross-window-sync";

/** Mounted once inside CoreProvider: see `cross-window-sync.ts` for what is (and is not) sent. */
export function CrossWindowSync(): null {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const windowId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sync = connectCacheSync(new BroadcastChannel(SYNC_CHANNEL), windowId, () => {
      // Active queries only: what is on screen refetches, the rest is marked stale for later.
      void queryClient.invalidateQueries({ refetchType: "active" });
    });
    const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success") sync.notify();
    });
    return () => {
      unsubscribe();
      sync.dispose();
    };
  }, [queryClient]);
  return null;
}

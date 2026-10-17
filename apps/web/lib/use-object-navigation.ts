"use client";

import { useCanLeaveObject } from "@orion/core-react";
import { useToast } from "@orion/ui";
import { useCallback } from "react";

/** Keeps the existing editor mounted when its autosave needs attention. */
export function useObjectNavigation(workspaceId: string | undefined): (nextEntityId?: string | null) => boolean {
  const canLeave = useCanLeaveObject(workspaceId);
  const { toast } = useToast();
  return useCallback((nextEntityId?: string | null) => {
    if (canLeave(nextEntityId)) return true;
    toast({ title: "Изменения ещё не сохранены", description: "Дождитесь сохранения или устраните ошибку в задаче." });
    return false;
  }, [canLeave, toast]);
}

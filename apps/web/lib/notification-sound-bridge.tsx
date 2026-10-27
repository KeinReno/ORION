"use client";

import { useNotifications, useSession } from "@orion/core-react";
import { useUiSound } from "@orion/ui";
import { useEffect, useRef } from "react";
import { useActiveWorkspace } from "./use-active-workspace";

/**
 * Plays `notify.reminder` for a notification that arrives while the tab is open — task/event
 * reminders, finance alerts, etc. Mirrors the "seen id" diffing `agent-presence.tsx` uses against
 * its own polling: the first fetch after mount/workspace-switch only records ids (so pre-existing
 * unread items on open/switch stay silent), every fetch after that sounds once per genuinely new id.
 * One instance for the whole window, mounted in `providers.tsx` next to `PreferencesEffect`.
 */
export function NotificationSoundBridge(): null {
  const { user } = useSession();
  const { workspace } = useActiveWorkspace();
  const notifications = useNotifications(user ? workspace?.id : undefined);
  const { play } = useUiSound();
  const seenIds = useRef<Set<string> | null>(null);
  const seenWorkspaceId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (seenWorkspaceId.current !== workspace?.id) {
      seenWorkspaceId.current = workspace?.id;
      seenIds.current = null;
    }
  }, [workspace?.id]);

  useEffect(() => {
    const data = notifications.data;
    if (!data) return;
    if (!seenIds.current) {
      seenIds.current = new Set(data.map((item) => item.id));
      return;
    }
    const hasNewUnread = data.some((item) => !item.readAt && !seenIds.current!.has(item.id));
    for (const item of data) seenIds.current.add(item.id);
    if (hasNewUnread) play("notify.reminder");
  }, [notifications.data, play]);

  return null;
}

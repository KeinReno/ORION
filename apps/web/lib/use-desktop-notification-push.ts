"use client";

import { useNotifications, usePreferences } from "@orion/core-react";
import type { Notification } from "@orion/shared-types";
import { isWithinQuietHours } from "@orion/shared-types";
import { useEffect, useRef } from "react";
import { isTauri } from "./is-tauri";

const TOASTED_KEY = "orion.notifiedNotificationIds";
/** The ledger is a "don't toast twice" guard, not history — cap it so old ids can't grow without bound. */
const LEDGER_LIMIT = 300;
/**
 * Only rows fired in the last few minutes toast: the feed is unfiltered
 * history, and without this window the first launch after the feature
 * appears would pop one toast per ancient unread reminder. The poll interval
 * is 60s, so a fresh reminder is always well inside the window by the time
 * the client sees it.
 */
const FRESH_WINDOW_MS = 10 * 60 * 1000;

function loadToastedIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(TOASTED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveToastedIds(ids: Set<string>): void {
  try {
    window.localStorage.setItem(TOASTED_KEY, JSON.stringify([...ids].slice(-LEDGER_LIMIT)));
  } catch {
    // best-effort only — a failed write means a repeated toast later, nothing worse
  }
}

/**
 * The server-side reminder crons (due tasks, calendar events) deliver to
 * Telegram and the in-app notification centre — but the desktop app itself
 * never interrupted the user for them. This hook bridges the centre's feed
 * (already polled for the bell) to a native OS toast inside the Tauri shell,
 * so a fired calendar reminder pops up even when ORION is in the background.
 *
 * Only the reminder kinds toast, each behind its own preference toggle
 * (`taskReminders`, `eventReminders`) plus the master `desktopNotifications`
 * switch and quiet hours — the exact gates the API-side delivery respects
 * (through the shared `isWithinQuietHours`, so both sides agree). Each
 * notification toasts once per device (localStorage ledger), and only while
 * the app is running: true push with the app closed needs a background
 * service, which is a separate piece of infrastructure.
 */
export function useDesktopNotificationPush(workspaceId: string | undefined): void {
  const { data: notifications } = useNotifications(workspaceId);
  const { data: preferences } = usePreferences();
  const toastedRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!isTauri() || !notifications || notifications.length === 0) return;
    if (preferences && !preferences.desktopNotifications) return;
    if (
      preferences &&
      isWithinQuietHours(preferences.quietHoursStart, preferences.quietHoursEnd, new Date(), preferences.timeZone)
    ) {
      return;
    }

    const wants = (kind: Notification["kind"]): boolean => {
      if (!preferences) return kind === "task_due" || kind === "event_reminder";
      if (kind === "task_due") return preferences.taskReminders;
      if (kind === "event_reminder") return preferences.eventReminders;
      return false;
    };

    if (!toastedRef.current) {
      toastedRef.current = loadToastedIds();
    }
    const toasted = toastedRef.current;

    // Claim synchronously, before the permission await, so an overlapping
    // effect run (a refetch landing mid-flight) cannot toast the same row twice.
    const freshSince = Date.now() - FRESH_WINDOW_MS;
    const fresh = notifications.filter(
      (notification) =>
        !notification.readAt &&
        wants(notification.kind) &&
        !toasted.has(notification.id) &&
        new Date(notification.createdAt).getTime() >= freshSince
    );
    if (fresh.length === 0) return;
    for (const notification of fresh) toasted.add(notification.id);
    saveToastedIds(toasted);

    void (async () => {
      const { isPermissionGranted, requestPermission, sendNotification } = await import(
        "@tauri-apps/plugin-notification"
      );

      let granted = await isPermissionGranted();
      if (!granted) {
        granted = (await requestPermission()) === "granted";
      }
      if (!granted) {
        // Release the claim so a later run (once permission is granted) can still toast.
        for (const notification of fresh) toasted.delete(notification.id);
        saveToastedIds(toasted);
        return;
      }

      for (const notification of fresh) {
        sendNotification({ title: notification.title, body: notification.body || undefined });
      }
    })();
  }, [notifications, preferences]);
}

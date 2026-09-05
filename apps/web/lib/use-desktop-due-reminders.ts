"use client";

import type { Task } from "@orion/shared-types";
import { useEffect, useRef } from "react";

const NOTIFIED_KEY = "orion.notifiedTaskIds";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function loadNotifiedIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(NOTIFIED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveNotifiedIds(ids: Set<string>): void {
  try {
    window.localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...ids]));
  } catch {
    // best-effort only — a failed write just means we might toast again later
  }
}

/**
 * Native Windows toast for overdue tasks, as a courtesy backup to the
 * server's Telegram notifications. Only fires inside the Tauri desktop
 * shell, only while the app is open, and only once per task per device
 * (tracked in localStorage) — a per-session reminder, not a durable
 * background service. See ORION v0.1 plan.
 */
export function useDesktopDueReminders(tasks: Task[] | undefined): void {
  const notifiedRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!isTauri() || !tasks || tasks.length === 0) return;
    if (!notifiedRef.current) {
      notifiedRef.current = loadNotifiedIds();
    }
    const notified = notifiedRef.current;

    const overdue = tasks.filter(
      (task) => task.status !== "done" && task.dueAt && new Date(task.dueAt).getTime() < Date.now() && !notified.has(task.id)
    );
    if (overdue.length === 0) return;

    // Claim these ids synchronously, before any await, so an overlapping
    // effect run (e.g. a second refetch landing while this one is still
    // awaiting the permission check below) sees them as already handled
    // instead of independently deciding to notify the same task too.
    for (const task of overdue) notified.add(task.id);
    saveNotifiedIds(notified);

    void (async () => {
      const { isPermissionGranted, requestPermission, sendNotification } = await import(
        "@tauri-apps/plugin-notification"
      );

      let granted = await isPermissionGranted();
      if (!granted) {
        granted = (await requestPermission()) === "granted";
      }
      if (!granted) {
        // Never actually shown — release the claim so a future run (once
        // permission is granted) can still notify about these tasks.
        for (const task of overdue) notified.delete(task.id);
        saveNotifiedIds(notified);
        return;
      }

      for (const task of overdue) {
        sendNotification({ title: "Просрочена задача — ORION", body: task.title });
      }
    })();
  }, [tasks]);
}

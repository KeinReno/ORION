"use client";

import { useEffect } from "react";
import { isTauri } from "./is-tauri";
import { setSecondaryDockDetachedElsewhere } from "./secondary-dock";

/**
 * Cross-window half of ORION-11: the second dock is rendered either docked
 * inside the main window (`app/(app)/layout.tsx`) or, after "Открепить на
 * другой экран", inside its own window at `/panel/secondary` — never both at
 * once, so there is exactly one dockview layout to persist
 * (`dockLayoutStorageKey(..., "secondary")`) and no risk of the two drifting
 * apart. A `BroadcastChannel` is the only thing that needs to cross windows:
 * who currently has it, and a way to ask the detached window to give it
 * back. `localStorage`/the saved dock layout itself needs no relaying —
 * both windows read the very same key when they render the dock.
 */
type Message = { type: "ping" } | { type: "detached" } | { type: "redocked" } | { type: "redock-request" };

const CHANNEL_NAME = "orion.secondaryDock.window";

function openChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

async function closeThisWindow(): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } else {
    window.close();
  }
}

/** Opens the second dock in its own window — a real native window in Tauri, a plain popup in the browser. */
export async function detachSecondaryDockToWindow(workspaceId: string | null): Promise<void> {
  const url = `/panel/secondary${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`;
  if (isTauri()) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    new WebviewWindow(`secondary-dock-${Date.now()}`, { url, title: "ORION — второй сайдбар", width: 440, height: 820 });
  } else {
    window.open(url, "orion-secondary-dock", "width=440,height=820");
  }
}

/**
 * Main-window side: tracks whether some other window currently owns the
 * dock (via `isSecondaryDockDetachedElsewhere`/the shared store) and offers
 * `requestRedock` for the "Вернуть в это окно" action. Re-pings on window
 * focus, not just on mount — if the detached window's process died without
 * firing `beforeunload` (a crash, a forcibly closed display), the main
 * window would otherwise be stuck believing it's detached forever; refocusing
 * it re-asks and a missing answer (no "detached" reply) is simply not
 * distinguishable from "really gone", so staying docked-unavailable until the
 * user explicitly opens it again is the safe default rather than a hidden
 * dock nobody can reach.
 */
export function useSecondaryDockHost(): { requestRedock: () => void } {
  useEffect(() => {
    const channel = openChannel();
    if (!channel) return;
    const onMessage = (event: MessageEvent<Message>) => {
      if (event.data.type === "detached") setSecondaryDockDetachedElsewhere(true);
      else if (event.data.type === "redocked") setSecondaryDockDetachedElsewhere(false);
    };
    channel.addEventListener("message", onMessage);
    channel.postMessage({ type: "ping" });
    const onFocus = () => channel.postMessage({ type: "ping" });
    window.addEventListener("focus", onFocus);
    return () => {
      channel.removeEventListener("message", onMessage);
      window.removeEventListener("focus", onFocus);
      channel.close();
    };
  }, []);
  return {
    requestRedock: () => {
      const channel = openChannel();
      channel?.postMessage({ type: "redock-request" });
      channel?.close();
    }
  };
}

/** The detached window's side (`PanelWindow`-style page at `/panel/secondary`). */
export function useSecondaryDockGuest(): void {
  useEffect(() => {
    const channel = openChannel();
    if (!channel) return;
    const announce = () => channel.postMessage({ type: "detached" });
    announce();
    const onMessage = (event: MessageEvent<Message>) => {
      if (event.data.type === "ping") announce();
      else if (event.data.type === "redock-request") void closeThisWindow();
    };
    channel.addEventListener("message", onMessage);
    const onUnload = () => channel.postMessage({ type: "redocked" });
    window.addEventListener("beforeunload", onUnload);
    return () => {
      channel.removeEventListener("message", onMessage);
      window.removeEventListener("beforeunload", onUnload);
      channel.close();
    };
  }, []);
}

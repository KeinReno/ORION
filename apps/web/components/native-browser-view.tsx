"use client";

import { Button } from "@orion/ui";
import { useEffect, useRef, useState } from "react";
import { visibleBrowserArea } from "../lib/native-browser";

export interface BrowserAction { sequence: number; name: "reload" | "back" | "forward" }

/** The DOM owns the layout; the external WebView owns the actual top-level browsing context. */
export function NativeBrowserView({ url, onNavigate, action }: { url: string; onNavigate: (url: string) => void; action: BrowserAction | null }): React.ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef({ url, onNavigate, action });
  latest.current = { url, onNavigate, action };
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = crypto.randomUUID().replace(/-/g, "");
    let disposed = false, failed = false, opened = false, working = false, lastBounds = "", lastUrl = latest.current.url;
    let sequence = latest.current.action?.sequence ?? 0;
    let unlisten: (() => void) | undefined;
    let run: (() => void) | undefined;
    let dragging = false;
    const dragStart = () => { dragging = true; run?.(); };
    const dragEnd = () => { dragging = false; run?.(); };
    let timer: ReturnType<typeof setInterval> | undefined;
    let observer: MutationObserver | undefined;
    setError(false);
    setLoading(true);

    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      const control = (name: string, extra = {}) => invoke("browser_control", { id, action: name, ...extra });
      unlisten = await listen<{ id: string; url: string; loading: boolean }>("orion-browser-page", ({ payload }) => {
        if (disposed || payload.id !== id) return;
        setLoading(payload.loading);
        lastUrl = payload.url;
        latest.current.onNavigate(payload.url);
      });
      if (disposed) { unlisten(); return; }

      const sync = async (): Promise<void> => {
        if (disposed || failed || working) return;
        working = true;
        try {
          const element = container.current;
          // Native child webviews draw above HTML. Hide them while ORION's dialogs, menus or drags need the surface.
          const covered = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], .dv-drag-over-container, .dv-drag-and-drop-overlay')].some((overlay) => {
            const box = overlay.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && getComputedStyle(overlay).visibility !== "hidden";
          });
          const bounds = element && !document.hidden && !covered && !dragging && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            ? visibleBrowserArea(element) : null;
          const encoded = JSON.stringify(bounds);
          if (!opened) {
            if (!bounds) return;
            await invoke("browser_open", { id, url: latest.current.url, bounds });
            opened = true;
            if (disposed) { await control("close"); return; }
            lastBounds = encoded;
          } else if (encoded !== lastBounds) {
            await control(bounds ? "show" : "hide", bounds ? { bounds } : {});
            lastBounds = encoded;
          }
          if (latest.current.url !== lastUrl) {
            lastUrl = latest.current.url;
            await control("navigate", { url: lastUrl });
          }
          const next = latest.current.action;
          if (next && next.sequence !== sequence) {
            sequence = next.sequence;
            await control(next.name);
          }
        } catch {
          failed = true;
          if (opened) await control("close").catch(() => undefined);
          if (!disposed) setError(true);
        } finally { working = false; }
      };
      run = () => { void sync(); };
      // Layout, dock tab changes and overlays all affect native bounds, even without a window resize.
      observer = new MutationObserver(run);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "hidden", "open"] });
      timer = setInterval(run, 200);
      window.addEventListener("resize", run);
      window.addEventListener("scroll", run, true);
      document.addEventListener("visibilitychange", run);
      window.addEventListener("dragstart", dragStart, true);
      window.addEventListener("dragend", dragEnd, true);
      window.addEventListener("drop", dragEnd, true);
      run();
    })().catch(() => { if (!disposed) setError(true); });

    return () => {
      disposed = true;
      unlisten?.();
      observer?.disconnect();
      window.removeEventListener("dragstart", dragStart, true);
      window.removeEventListener("dragend", dragEnd, true);
      window.removeEventListener("drop", dragEnd, true);
      if (timer) clearInterval(timer);
      if (run) {
        window.removeEventListener("resize", run);
        window.removeEventListener("scroll", run, true);
        document.removeEventListener("visibilitychange", run);
      }
      if (opened) void import("@tauri-apps/api/core").then(({ invoke }) => invoke("browser_control", { id, action: "close" })).catch(() => undefined);
    };
  }, [attempt]);

  return <div ref={container} className="relative h-full w-full bg-background" aria-label="Страница встроенного браузера">
    {error ? <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-label">
      <p>Не удалось запустить встроенный браузер.</p>
      <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>Повторить запуск</Button>
    </div> : <p role="status" className="p-4 text-label text-muted-foreground">{loading ? "Открываю страницу…" : ""}</p>}
  </div>;
}

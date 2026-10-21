import { useEffect } from "react";
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { App } from "@capacitor/app";

const Depth = registerPlugin<{
  start(): Promise<{ available: boolean }>; stop(): Promise<void>;
  addListener(name: "tilt", callback: (value: { x: number; y: number }) => void): Promise<PluginListenerHandle>;
}>("OrionDepth");
let queue: Promise<unknown> = Promise.resolve();
function serial(work: () => Promise<unknown>) { queue = queue.catch(() => {}).then(work); return queue; }

export function useDepth(enabled: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    let alive = true; let active = true; let touching = false; let wanted = false;
    let frame = 0; let resume = 0; let latest = { x: 0, y: 0 };
    let listener: Promise<PluginListenerHandle> | null = null;
    const reset = () => {
      if (frame) cancelAnimationFrame(frame); frame = 0;
      root.dataset.depth = "off";
      for (const key of ["x", "y"]) root.style.setProperty("--depth-" + key, "0px");
      for (const key of ["rx", "ry"]) root.style.setProperty("--depth-" + key, "0deg");
    };
    const paint = () => {
      frame = 0; if (!alive || !wanted || touching) return;
      root.style.setProperty("--depth-x", `${(latest.x * 2.5).toFixed(2)}px`);
      root.style.setProperty("--depth-y", `${(latest.y * 2.5).toFixed(2)}px`);
      root.style.setProperty("--depth-rx", `${(-latest.y * 3).toFixed(2)}deg`);
      root.style.setProperty("--depth-ry", `${(latest.x * 3).toFixed(2)}deg`);
    };
    const sync = () => {
      const editing = document.activeElement?.matches("input,textarea,select");
      const next = alive && enabled && Capacitor.isNativePlatform() && active && !document.hidden && !editing && !touching && root.dataset.motion === "full";
      if (next === wanted) return;
      wanted = next; reset();
      void serial(async () => {
        if (!next || !alive || !wanted) { await Depth.stop(); return; }
        if (listener) await listener;
        const state = await Depth.start();
        if (alive && wanted && state.available) root.dataset.depth = "active";
        else await Depth.stop();
      }).catch(() => { if (alive) reset(); });
    };
    reset();
    if (Capacitor.isNativePlatform() && enabled) {
      listener = Depth.addListener("tilt", (value) => {
        if (!alive || !wanted || root.dataset.depth !== "active" || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return;
        latest = { x: Math.max(-1, Math.min(1, value.x)), y: Math.max(-1, Math.min(1, value.y)) };
        if (!frame) frame = requestAnimationFrame(paint);
      });
      void listener.catch(() => {});
    }
    const down = () => { touching = true; clearTimeout(resume); sync(); };
    const up = () => { touching = false; clearTimeout(resume); resume = window.setTimeout(sync, 200); };
    const focus = () => { clearTimeout(resume); resume = window.setTimeout(sync, 0); };
    const visibility = () => sync();
    const observer = new MutationObserver(sync); observer.observe(root, { attributes: true, attributeFilter: ["data-motion"] });
    document.addEventListener("pointerdown", down, true); document.addEventListener("pointerup", up, true); document.addEventListener("pointercancel", up, true);
    document.addEventListener("focusin", focus); document.addEventListener("focusout", focus); document.addEventListener("visibilitychange", visibility);
    const app = Capacitor.isNativePlatform() ? App.addListener("appStateChange", ({ isActive }) => { active = isActive; touching = false; if (isActive) wanted = false; sync(); }) : null;
    sync();
    return () => {
      alive = false; wanted = false; clearTimeout(resume); reset(); observer.disconnect();
      document.removeEventListener("pointerdown", down, true); document.removeEventListener("pointerup", up, true); document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("focusin", focus); document.removeEventListener("focusout", focus); document.removeEventListener("visibilitychange", visibility);
      void listener?.then((handle) => handle.remove()).catch(() => {}); void app?.then((handle) => handle.remove());
      if (Capacitor.isNativePlatform()) void serial(() => Depth.stop()).catch(() => {});
    };
  }, [enabled]);
}

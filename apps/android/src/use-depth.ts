import { useEffect, useRef, useState } from "react";
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { App } from "@capacitor/app";

const Depth = registerPlugin<{
  start(): Promise<{ available: boolean }>; stop(): Promise<void>;
  addListener(name: "tilt", callback: (value: { x: number; y: number }) => void): Promise<PluginListenerHandle>;
}>("OrionDepth");
let queue: Promise<unknown> = Promise.resolve();
function serial(work: () => Promise<unknown>) { queue = queue.catch(() => {}).then(work); return queue; }

export function useDepth(enabled: boolean, strength = 60) {
  const strengthRef = useRef(strength);
  strengthRef.current = strength;
  const [status, setStatus] = useState("Ожидание датчика…");
  useEffect(() => {
    const root = document.documentElement;
    let alive = true; let active = true; let touching = false; let wanted = false;
    let frame = 0; let resume = 0; let watchdog = 0; let latest = { x: 0, y: 0 }; let received = false;
    let listener: Promise<PluginListenerHandle> | null = null;
    const reset = () => {
      if (frame) cancelAnimationFrame(frame); frame = 0;
      root.querySelectorAll<HTMLElement>(".depth-card-body").forEach((element) => element.style.removeProperty("transform"));
      root.dataset.depth = "off";
      root.style.setProperty("--depth-lift", "0px");
      for (const key of ["x", "y"]) root.style.setProperty("--depth-" + key, "0px");
      for (const key of ["rx", "ry"]) root.style.setProperty("--depth-" + key, "0deg");
    };
    const paint = () => {
      frame = 0; if (!alive || !wanted || touching) return;
      const scale = strengthRef.current / 100;
      root.style.setProperty("--depth-lift", `${(24 * scale).toFixed(2)}px`);
      root.style.setProperty("--depth-x", `${(Math.max(-1, Math.min(1, latest.x * 1.5)) * 32 * scale).toFixed(2)}px`);
      root.style.setProperty("--depth-y", `${(Math.max(-1, Math.min(1, latest.y * 1.5)) * 32 * scale).toFixed(2)}px`);
      root.style.setProperty("--depth-rx", `${(-Math.max(-1, Math.min(1, latest.y * 1.5)) * 28 * scale).toFixed(2)}deg`);
      root.style.setProperty("--depth-ry", `${(Math.max(-1, Math.min(1, latest.x * 1.5)) * 28 * scale).toFixed(2)}deg`);
    };
    const sync = () => {
      const editing = document.activeElement?.matches("input:not([type=range]):not([type=checkbox]):not([type=radio]),textarea,select");
      const next = alive && enabled && Capacitor.isNativePlatform() && active && !document.hidden && !editing && !touching && root.dataset.motion === "full";
      if (!next) setStatus(!enabled ? "Эффект выключен" : !Capacitor.isNativePlatform() ? "Датчик доступен в Android-приложении" : root.dataset.motion !== "full" ? "Анимации отключены в настройках телефона" : "Пауза: касание, ввод или приложение в фоне");
      if (next === wanted) { if (!next && !touching) reset(); return; }
      wanted = next;
      // Freeze the card under the finger: resetting here changes the pointer-up target.
      if (touching && root.dataset.depth === "active" && root.dataset.motion === "full") {
        const cards = Array.from(root.querySelectorAll<HTMLElement>(".depth-card-body"));
        const transforms = cards.map((element) => getComputedStyle(element).transform);
        cards.forEach((element, index) => { element.style.transform = transforms[index]!; });
        root.dataset.depth = "paused";
      } else if (!touching || root.dataset.motion !== "full") reset();
      clearTimeout(watchdog); received = false;
      void serial(async () => {
        if (!next || !alive || !wanted) { await Depth.stop(); return; }
        if (listener) await listener;
        const state = await Depth.start();
        if (alive && wanted && state.available) {
          root.dataset.depth = "active"; setStatus("Ожидание данных датчика…");
          watchdog = window.setTimeout(() => { if (alive && wanted && !received) setStatus("Данные не поступают. Попробуйте выключить и включить эффект."); }, 2500);
        } else { if (alive && wanted) setStatus("Датчик наклона недоступен"); await Depth.stop(); }
      }).catch(() => { if (alive) { reset(); setStatus("Не удалось подключить датчик наклона"); } });
    };
    reset();
    if (Capacitor.isNativePlatform() && enabled) {
      listener = Depth.addListener("tilt", (value) => {
        if (!alive || !wanted || root.dataset.depth !== "active" || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return;
        if (!received) { received = true; clearTimeout(watchdog); setStatus("Датчик работает — наклоните телефон"); }
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
      alive = false; wanted = false; clearTimeout(resume); clearTimeout(watchdog); reset(); observer.disconnect();
      document.removeEventListener("pointerdown", down, true); document.removeEventListener("pointerup", up, true); document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("focusin", focus); document.removeEventListener("focusout", focus); document.removeEventListener("visibilitychange", visibility);
      void listener?.then((handle) => handle.remove()).catch(() => {}); void app?.then((handle) => handle.remove());
      if (Capacitor.isNativePlatform()) void serial(() => Depth.stop()).catch(() => {});
    };
  }, [enabled]);
  return { status };
}

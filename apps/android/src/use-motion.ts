import { useEffect, useRef } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";

const Motion = registerPlugin<{ getState(): Promise<{ reduced: boolean }> }>("OrionMotion");

export function useVisualMotion(route: string) {
  const animation = useRef<Animation | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let nativeReduced = Capacitor.isNativePlatform();
    let alive = true;
    const apply = () => {
      if (!alive) return;
      root.dataset.motion = media.matches || nativeReduced ? "reduced" : "full";
      if (root.dataset.motion === "reduced") {
        animation.current?.cancel();
        for (const active of document.getAnimations?.() ?? []) active.cancel();
      }
    };
    const refresh = async () => {
      if (Capacitor.isNativePlatform()) {
        try { const state = await Motion.getState(); nativeReduced = state.reduced !== false; }
        catch { nativeReduced = true; }
      }
      apply();
    };
    const pointer = (event: PointerEvent) => {
      root.dataset.input = "pointer";
      const button = (event.target as Element)?.closest<HTMLButtonElement>("button");
      if (!button || button.disabled || root.dataset.motion !== "full") return;
      const rect = button.getBoundingClientRect();
      button.style.setProperty("--press-x", `${event.clientX - rect.left}px`);
      button.style.setProperty("--press-y", `${event.clientY - rect.top}px`);
    };
    const keyboard = () => { root.dataset.input = "keyboard"; animation.current?.cancel(); };
    apply(); void refresh();
    media.addEventListener("change", apply);
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    const listener = Capacitor.isNativePlatform() ? App.addListener("appStateChange", ({ isActive }) => { if (isActive) void refresh(); }) : null;
    return () => {
      alive = false; media.removeEventListener("change", apply);
      document.removeEventListener("pointerdown", pointer, true); document.removeEventListener("keydown", keyboard, true);
      void listener?.then((handle) => handle.remove());
    };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const surface = document.querySelector<HTMLElement>(".content, .editor");
    animation.current?.cancel();
    if (surface && typeof surface.animate === "function" && root.dataset.motion === "full" && root.dataset.input === "pointer") {
      animation.current = surface.animate([
        { opacity: 0.9, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" },
      ], { duration: 160, easing: "cubic-bezier(.16,1,.3,1)" });
    }
    return () => animation.current?.cancel();
  }, [route]);
}

"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { visualMotionCss } from "./motion-kit";

export const CALM_BACKGROUNDS = [
  "gradient",
  "grid-dots",
  "dotted-glow",
  "scales",
  "noise",
  "gradient-shift",
  "silk",
  "waves",
  "threads",
  "ghost-fibers",
  "soft-aurora",
  "grainient",
  "plasma",
  "line-waves",
  "light-rays",
  "side-rays",
  "dot-grid",
  "beams",
  "particles"
] as const;

export type CalmBackgroundId = (typeof CALM_BACKGROUNDS)[number];

export const CALM_BACKGROUND_LABELS: Record<CalmBackgroundId, string> = {
  gradient: "Градиент",
  "grid-dots": "Сетка точек",
  "dotted-glow": "Светящиеся точки",
  scales: "Чешуя",
  noise: "Зерно",
  "gradient-shift": "Живой градиент",
  silk: "Шёлк",
  waves: "Волны",
  threads: "Нити",
  "ghost-fibers": "Волокна",
  "soft-aurora": "Тихая аврора",
  grainient: "Зернистый градиент",
  plasma: "Плазма",
  "line-waves": "Линейные волны",
  "light-rays": "Лучи",
  "side-rays": "Боковые лучи",
  "dot-grid": "Точечное поле",
  beams: "Ленты",
  particles: "Частицы"
};

export function CalmBackground({ id, className }: { id: CalmBackgroundId; className?: string }): React.ReactElement {
  const still = typeof document !== "undefined" && (document.documentElement.dataset.motion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  return (
    <div aria-hidden className={clsx("relative overflow-hidden bg-[#121316]", className)}>
      <div className={clsx("absolute inset-0", still && "![animation:none]")} data-calm={id} style={styleFor(id)} />
    </div>
  );
}

function styleFor(id: CalmBackgroundId): React.CSSProperties {
  const accent = "rgb(var(--kaiden-accent-base) / 0.55)";
  const shared: React.CSSProperties = { backgroundSize: "cover" };
  switch (id) {
    case "gradient":
      return { background: `radial-gradient(60% 50% at 20% 20%, ${accent}, transparent 70%), radial-gradient(40% 40% at 80% 70%, rgb(255 255 255 / 0.08), transparent 70%)` };
    case "grid-dots":
    case "dot-grid":
      return { backgroundImage: "radial-gradient(rgb(255 255 255 / 0.28) 1px, transparent 1px)", backgroundSize: "18px 18px" };
    case "dotted-glow":
      return { backgroundImage: `radial-gradient(${accent} 1px, transparent 1px)`, backgroundSize: "22px 22px", filter: "blur(0.2px)" };
    case "scales":
      return { backgroundImage: "repeating-linear-gradient(135deg, rgb(255 255 255 / 0.08) 0 1px, transparent 1px 12px)" };
    case "noise":
    case "grainient":
      return { backgroundImage: `radial-gradient(50% 50% at 30% 30%, ${accent}, transparent 70%), radial-gradient(rgb(255 255 255) 0.5px, transparent 0.5px)`, backgroundSize: "cover, 3px 3px" };
    case "gradient-shift":
    case "plasma":
    case "soft-aurora":
      return { ...shared, background: `linear-gradient(120deg, transparent, ${accent}, transparent, rgb(255 255 255 / 0.12), transparent)`, backgroundSize: "200% 200%", animation: "orion-pan 14s ease-in-out infinite" };
    case "silk":
    case "waves":
    case "line-waves":
      return { backgroundImage: "repeating-radial-gradient(circle at 0 100%, rgb(255 255 255 / 0.14) 0 1px, transparent 1px 14px)", animation: "orion-pan 18s linear infinite" };
    case "threads":
    case "ghost-fibers":
      return { backgroundImage: "repeating-linear-gradient(90deg, transparent 0 18px, rgb(255 255 255 / 0.12) 18px 19px)", animation: "orion-pan 16s linear infinite" };
    case "light-rays":
    case "side-rays":
    case "beams":
      return { background: `conic-gradient(from 200deg at ${id === "side-rays" ? "0% 100%" : "50% 120%"}, transparent 0 70%, ${accent} 78%, transparent 86%)`, opacity: 0.85 };
    case "particles":
      return { backgroundImage: "radial-gradient(circle, rgb(255 255 255 / 0.7) 0 1px, transparent 1.5px)", backgroundSize: "46px 38px, 70px 54px", animation: "orion-pan 22s linear infinite" };
    default:
      return {};
  }
}

export function BackgroundSwatch({ id, label, selected, onSelect }: { id: CalmBackgroundId; label: string; selected?: boolean; onSelect: () => void }): React.ReactElement {
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} className={clsx("overflow-hidden rounded-lg border text-left", selected ? "border-ui-button" : "border-ui-border")}>
      <CalmBackground id={id} className="h-16 w-full" />
      <span className="block px-2 py-1 text-micro text-ui-secondary">{label}</span>
    </button>
  );
}

export function calmBackgroundCss(): string {
  return "@keyframes orion-pan{from{background-position:0% 50%}50%{background-position:100% 50%}to{background-position:0% 50%}}";
}

export function VisualStyle(): React.ReactElement {
  return <style>{`${calmBackgroundCss()}${visualMotionCss()}`}</style>;
}

export function BackgroundFrame({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="relative">{children}</div>;
}

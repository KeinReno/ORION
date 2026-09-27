"use client";

import { lazy, Suspense } from "react";
import { hexToRgb } from "./shader-canvas";

const LiquidEther = lazy(() => import("./liquid-ether"));
const LightPillar = lazy(() => import("./light-pillar"));
const DarkVeil = lazy(() => import("./dark-veil"));
const ShapeWaves = lazy(() => import("./shape-waves"));

export const WEBGL_BACKGROUND_STYLES = ["liquid-ether", "light-pillar", "dark-veil", "shape-waves"] as const;
export type WebglBackgroundStyle = (typeof WEBGL_BACKGROUND_STYLES)[number];

/**
 * One config shape per effect, mirroring `@orion/shared-types`'
 * `backgroundEffectSettingsSchema` structurally rather than importing it —
 * `packages/ui` stays a dumb presentational package with no dependency on
 * the contract package (see CLAUDE.md), same as `WEBGL_BACKGROUND_STYLES`
 * above already duplicates the shared-types constant of the same name.
 */
export interface LiquidEtherConfig {
  speed: number;
  color: string | null;
  colorSecondary: string | null;
  density: number;
  mouseForce: number;
  autoDemo: boolean;
}
export interface LightPillarConfig {
  speed: number;
  color: string | null;
  density: number;
  pillarWidth: number;
  rayIntensity: number;
  flicker: number;
}
export interface DarkVeilConfig {
  speed: number;
  color: string | null;
  density: number;
  hueShift: number;
  warpAmount: number;
  scanlineIntensity: number;
}
export interface ShapeWavesConfig {
  speed: number;
  color: string | null;
  density: number;
  gap: number;
  waveAmplitude: number;
  shape: "circle" | "square";
}
export interface BackgroundEffectSettings {
  "liquid-ether": LiquidEtherConfig;
  "light-pillar": LightPillarConfig;
  "dark-veil": DarkVeilConfig;
  "shape-waves": ShapeWavesConfig;
}

export interface WebglBackgroundProps {
  variant: WebglBackgroundStyle;
  settings: BackgroundEffectSettings;
  /** Normalized [0-1] RGB, read from the `--orion-accent` CSS variable — the "follow accent" fallback for a config's null `color`. */
  accentRgb: [number, number, number];
  /** 0–1, already resolved from the "low"/"medium"/"high" intensity preference. */
  opacity: number;
  className?: string;
}

/**
 * Lazily mounts one of the four OGL shader backgrounds, each fed its own
 * settings slice. Kept separate from `AppBackground`'s CSS aurora/grid
 * variants so those stay a zero-JS `<div>` — only opening a WebGL variant
 * pulls the `ogl` chunk in.
 */
export function WebglBackground({ variant, settings, accentRgb, opacity, className }: WebglBackgroundProps): React.ReactElement | null {
  return (
    <Suspense fallback={null}>
      {variant === "liquid-ether" ? (
        <LiquidEther
          color={settings["liquid-ether"].color ? hexToRgb(settings["liquid-ether"].color) : accentRgb}
          colorSecondary={settings["liquid-ether"].colorSecondary}
          speed={settings["liquid-ether"].speed}
          density={settings["liquid-ether"].density}
          mouseForce={settings["liquid-ether"].mouseForce}
          autoDemo={settings["liquid-ether"].autoDemo}
          opacity={opacity}
          className={className}
        />
      ) : null}
      {variant === "light-pillar" ? (
        <LightPillar
          color={settings["light-pillar"].color ? hexToRgb(settings["light-pillar"].color) : accentRgb}
          speed={settings["light-pillar"].speed}
          density={settings["light-pillar"].density}
          pillarWidth={settings["light-pillar"].pillarWidth}
          rayIntensity={settings["light-pillar"].rayIntensity}
          flicker={settings["light-pillar"].flicker}
          opacity={opacity}
          className={className}
        />
      ) : null}
      {variant === "dark-veil" ? (
        <DarkVeil
          color={settings["dark-veil"].color ? hexToRgb(settings["dark-veil"].color) : accentRgb}
          speed={settings["dark-veil"].speed}
          density={settings["dark-veil"].density}
          hueShift={settings["dark-veil"].hueShift}
          warpAmount={settings["dark-veil"].warpAmount}
          scanlineIntensity={settings["dark-veil"].scanlineIntensity}
          opacity={opacity}
          className={className}
        />
      ) : null}
      {variant === "shape-waves" ? (
        <ShapeWaves
          color={settings["shape-waves"].color ? hexToRgb(settings["shape-waves"].color) : accentRgb}
          speed={settings["shape-waves"].speed}
          density={settings["shape-waves"].density}
          gap={settings["shape-waves"].gap}
          waveAmplitude={settings["shape-waves"].waveAmplitude}
          shape={settings["shape-waves"].shape}
          opacity={opacity}
          className={className}
        />
      ) : null}
    </Suspense>
  );
}

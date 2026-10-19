"use client";

import { usePreferences, useSession } from "@orion/core-react";
import { TargetCursor, WEBGL_BACKGROUND_STYLES, WebglBackground, themeDocumentVariables, type WebglBackgroundStyle } from "@orion/ui";
import { effectiveApplicationTheme } from "./effective-application-theme";
import { useActiveWorkspace } from "./use-active-workspace";
import { useEffect, useState } from "react";

const INTENSITY_OPACITY: Record<string, number> = { low: 0.5, medium: 0.85, high: 1 };

/** "#7c3aed" → "124 58 237" (space-separated 0-255 triplet, the format every `--orion-*` color variable uses). */
function hexToRgbTriplet(hex: string | null | undefined): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}

/**
 * Applies the user's appearance preferences to the document root.
 *
 * `accent` swaps a CSS variable, `density` scales the root font size (every
 * Tailwind utility in the app is rem-based), `backgroundStyle`/
 * `backgroundIntensity` toggle the ambient `AppBackground` behind the shell,
 * and `surfaceStyle` makes the sidebar/panels/cards translucent so that
 * background actually shows through — all are plain `data-*` attributes
 * read by CSS in globals.css, the same mechanism as `accent`/`density`.
 * Precision is an explicit, saved user-global opt-in. Workspace switches never
 * rewrite it; nested panel previews retain their own scoped tokens.
 *
 * The four WebGL background variants (liquid-ether/light-pillar/dark-veil/
 * shape-waves) can't be pure CSS like aurora/grid — `backgroundSpeed`/
 * `backgroundColor`/`backgroundDensity` are JS values fed into shader
 * uniforms — so this component also mounts `<WebglBackground>` itself
 * (behind `AppBackground`'s `-z-10` div via its own fixed layer) instead of
 * leaving that to a dataset flag. Same for `targetCursorEnabled` →
 * `<TargetCursor>`.
 *
 * Mounted *inside* `CoreProvider` (see `providers.tsx`) and gated on a session:
 * asking for `/settings/preferences` on the login screen would just be a 401
 * that the API client has to refresh-and-retry through.
 */
export function PreferencesEffect(): React.ReactElement | null {
  const { user } = useSession();
  if (!user) return null;
  return <AppearanceSync />;
}

function AppearanceSync(): React.ReactElement | null {
  const { data } = usePreferences();
  // The workspace palette is part of the effective theme: switching spaces swaps it in the same effect pass,
  // so the previous space's colour never stays on the root (cleanup and re-apply run in one commit).
  const { workspace } = useActiveWorkspace();
  const workspaceTheme = workspace?.theme ?? null;
  const [accentRgb, setAccentRgb] = useState<[number, number, number]>([0.486, 0.231, 0.929]);

  useEffect(() => {
    if (!data) return;
    const root = document.documentElement;
    root.dataset.accent = data.accent;
    root.dataset.density = data.density;
    root.dataset.background = data.backgroundStyle;
    root.dataset.backgroundIntensity = data.backgroundIntensity;
    root.dataset.surface = data.surfaceStyle;
    // CSS transitions/keyframes read this (globals.css); framer-motion reads MotionLevelProvider.
    root.dataset.motion = data.motionLevel;
    root.dataset.orionDesign = data.theme === "kaiden-precision" ? "precision" : "legacy";
    const effectiveTheme = effectiveApplicationTheme(data, { theme: workspaceTheme });
    const precisionVariables = effectiveTheme ? themeDocumentVariables(effectiveTheme) : {};
    if (effectiveTheme) {
      root.dataset.orionPalette = effectiveTheme.id;
      root.style.setProperty("color-scheme", effectiveTheme.baseMode);
    }
    for (const [key, value] of Object.entries(precisionVariables)) root.style.setProperty(key, value);
    root.style.setProperty("--orion-panel-opacity", String(data.panelOpacity));
    root.style.setProperty("--orion-panel-blur", `${data.panelBlur}px`);
    root.style.setProperty("--orion-panel-tint", hexToRgbTriplet(data.panelAccent) ?? "13 13 17");

    // "follow accent" fallback for a background config's null `color`: read
    // the swatch the accent picker just set, rather than duplicating its hex
    // table here.
    const raw = getComputedStyle(root).getPropertyValue("--orion-accent").trim();
    const parts = raw.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      setAccentRgb([parts[0] / 255, parts[1] / 255, parts[2] / 255]);
    }
    return () => {
      delete root.dataset.orionDesign;
      delete root.dataset.orionPalette;
      root.style.removeProperty("color-scheme");
      for (const key of Object.keys(precisionVariables)) root.style.removeProperty(key);
    };
  }, [data, workspaceTheme]);

  if (!data) return null;

  const isWebglBackground = data.theme !== "kaiden-precision" && (WEBGL_BACKGROUND_STYLES as readonly string[]).includes(data.backgroundStyle);

  return (
    <>
      {isWebglBackground ? (
        <div aria-hidden className="orion-app-background-webgl pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <WebglBackground
            variant={data.backgroundStyle as WebglBackgroundStyle}
            settings={data.backgroundEffectSettings}
            accentRgb={accentRgb}
            opacity={INTENSITY_OPACITY[data.backgroundIntensity] ?? 0.85}
          />
        </div>
      ) : null}
      {data.targetCursorEnabled ? <TargetCursor /> : null}
    </>
  );
}

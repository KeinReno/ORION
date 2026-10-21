import { THEME_PRESETS, ARCTIC_THEME, PRECISION_THEME, themeDocumentVariables } from "@orion/ui/theme";
import type { MobileSettings } from "@orion/mobile-core";

export const DARK_PALETTES = THEME_PRESETS.filter((theme) => theme.baseMode === "dark");
export function applyMobileTheme(mode: MobileSettings["theme"], darkTheme: MobileSettings["darkTheme"], systemLight: boolean) {
  const light = mode === "light" || (mode === "system" && systemLight);
  const theme = light ? ARCTIC_THEME : DARK_PALETTES.find((entry) => entry.id === darkTheme) ?? PRECISION_THEME;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(themeDocumentVariables(theme))) root.style.setProperty(key, value);
  root.style.colorScheme = theme.baseMode;
  root.dataset.theme = mode;
  root.dataset.palette = theme.id;
}

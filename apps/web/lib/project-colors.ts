import { PALETTE_SWATCHES } from "@orion/ui";

/** Palette key → fill, for the colour dot of a project (card, chart legend). */
export function projectSwatchColor(key: string | null | undefined): string | undefined {
  return key ? PALETTE_SWATCHES.find((swatch) => swatch.key === key)?.color : undefined;
}

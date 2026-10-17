import { z } from "zod";

/** v1 is data-only: bounded identifiers and literal hex colors; no CSS or executable values. */
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
export const themeDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  name: z.string().trim().min(1).max(80),
  baseMode: z.enum(["dark", "light"]),
  colors: z.object({
    canvas: hex,
    surface: hex,
    elevated: hex,
    hover: hex,
    textPrimary: hex,
    textSecondary: hex,
    textSubtle: hex,
    border: hex,
    borderStrong: hex,
    accent: hex,
    accentHover: hex,
    accentForeground: hex,
    focus: hex,
    success: hex,
    warning: hex,
    danger: hex,
    info: hex,
    tint: hex,
  }).strict()
}).strict();
export type ThemeDocument = z.infer<typeof themeDocumentSchema>;

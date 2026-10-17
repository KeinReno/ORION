import { themeVariables, type DesignToken, type ThemeVariables } from "./design-tokens";

export const THEME_DOCUMENT_VERSION = 1 as const;
export const MAX_THEME_JSON_LENGTH = 16_384;

const COLOR_TOKENS = {
  canvas: "bg-canvas", surface: "bg-surface", elevated: "bg-elevated", hover: "bg-hover",
  textPrimary: "text-primary", textSecondary: "text-secondary", textSubtle: "text-subtle",
  border: "border-default", borderStrong: "border-strong", accent: "accent-base",
  accentHover: "accent-hover", accentForeground: "accent-foreground", focus: "focus-ring",
  success: "status-success", warning: "status-warning", danger: "status-danger", info: "status-info",
  tint: "tint-base"
} as const satisfies Record<string, DesignToken>;
export type ThemeColor = keyof typeof COLOR_TOKENS;
export interface ThemeDocument {
  schemaVersion: typeof THEME_DOCUMENT_VERSION;
  id: string;
  name: string;
  baseMode: "dark" | "light";
  colors: Record<ThemeColor, string>;
}

export const PRECISION_THEME: ThemeDocument = {
  schemaVersion: 1, id: "kaiden-precision", name: "KAIDEN Precision", baseMode: "dark",
  colors: {
    canvas: "#0f1012", surface: "#16171a", elevated: "#1d1e22", hover: "#27282d",
    textPrimary: "#f2f0ea", textSecondary: "#b2b0a9", textSubtle: "#a6a49f",
    border: "#414248", borderStrong: "#66676e", accent: "#c9a86a", accentHover: "#dec08b",
    accentForeground: "#16171a", focus: "#dec08b", success: "#10b981", warning: "#f59e0b",
    danger: "#fb7185", info: "#60a5fa", tint: "#ffffff"
  }
};
export const ARCTIC_THEME: ThemeDocument = {
  schemaVersion: 1, id: "arctic", name: "Arctic", baseMode: "light",
  colors: {
    canvas: "#f5f6f8", surface: "#ffffff", elevated: "#ffffff", hover: "#e8edf2",
    textPrimary: "#17212b", textSecondary: "#465564", textSubtle: "#586574",
    border: "#7a8794", borderStrong: "#657382", accent: "#305c8c", accentHover: "#24476e",
    accentForeground: "#ffffff", focus: "#305c8c", success: "#13734e", warning: "#925b10",
    danger: "#b42332", info: "#305c8c", tint: "#17212b"
  }
};

export const OBSIDIAN_THEME: ThemeDocument = {
  schemaVersion: 1, id: "obsidian", name: "Obsidian", baseMode: "dark",
  colors: { canvas: "#0e0e10", surface: "#151517", elevated: "#1c1c1f", hover: "#26262a", textPrimary: "#ececee", textSecondary: "#b0b0b6", textSubtle: "#a0a0a8", border: "#3f3f46", borderStrong: "#62626b", accent: "#a78bfa", accentHover: "#c4b5fd", accentForeground: "#14101f", focus: "#c4b5fd", success: "#34d399", warning: "#fbbf24", danger: "#fb7185", info: "#60a5fa", tint: "#ffffff" }
};

export const MIDNIGHT_THEME: ThemeDocument = {
  schemaVersion: 1, id: "midnight", name: "Midnight", baseMode: "dark",
  colors: { canvas: "#0a1020", surface: "#101a2e", elevated: "#172338", hover: "#1f2d47", textPrimary: "#eaf0fa", textSecondary: "#aebbd0", textSubtle: "#9aa9c0", border: "#3a4a66", borderStrong: "#5d7093", accent: "#6baaff", accentHover: "#94c2ff", accentForeground: "#08111f", focus: "#94c2ff", success: "#34d399", warning: "#fbbf24", danger: "#fb7185", info: "#60a5fa", tint: "#ffffff" }
};

export const EMERALD_THEME: ThemeDocument = {
  schemaVersion: 1, id: "emerald", name: "Emerald", baseMode: "dark",
  colors: { canvas: "#0e1210", surface: "#151b18", elevated: "#1c2420", hover: "#26312c", textPrimary: "#eef3f0", textSecondary: "#aebbb4", textSubtle: "#9eada5", border: "#3d4a43", borderStrong: "#5f7167", accent: "#34d399", accentHover: "#6ee7b7", accentForeground: "#06140e", focus: "#6ee7b7", success: "#4ade80", warning: "#fbbf24", danger: "#fb7185", info: "#60a5fa", tint: "#ffffff" }
};

export const CRIMSON_THEME: ThemeDocument = {
  schemaVersion: 1, id: "crimson", name: "Crimson", baseMode: "dark",
  colors: { canvas: "#120d0f", surface: "#1a1215", elevated: "#231a1d", hover: "#2f2226", textPrimary: "#f4eeef", textSecondary: "#bcadb0", textSubtle: "#aa9a9e", border: "#4a3a3f", borderStrong: "#78616a", accent: "#f0647a", accentHover: "#f68a9a", accentForeground: "#1a0a0e", focus: "#f68a9a", success: "#34d399", warning: "#fbbf24", danger: "#ff8a80", info: "#60a5fa", tint: "#ffffff" }
};

/** Built-in starting themes, in the order the preview selector shows them. */
export const THEME_PRESETS: readonly ThemeDocument[] = [PRECISION_THEME, OBSIDIAN_THEME, MIDNIGHT_THEME, EMERALD_THEME, CRIMSON_THEME, ARCTIC_THEME];

export type ThemeParseResult = { ok: true; value: ThemeDocument } | { ok: false; error: string };
function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Strict data-only v1 import. No CSS, URLs, executable expressions or arbitrary variable names. */
export function parseThemeDocument(input: unknown): ThemeParseResult {
  if (typeof input === "string") {
    if (input.length > MAX_THEME_JSON_LENGTH || new TextEncoder().encode(input).byteLength > MAX_THEME_JSON_LENGTH) return { ok: false, error: "Файл темы слишком большой (максимум 16 КБ)." };
    try { input = JSON.parse(input); } catch { return { ok: false, error: "Не удалось прочитать JSON темы." }; }
  }
  if (!plainObject(input)) return { ok: false, error: "Тема должна быть JSON-объектом." };
  if (input.schemaVersion !== THEME_DOCUMENT_VERSION) return { ok: false, error: "Эта версия формата темы не поддерживается." };
  if (Object.keys(input).some(key => !["schemaVersion", "id", "name", "baseMode", "colors"].includes(key))) {
    return { ok: false, error: "В теме есть неизвестные поля." };
  }
  if (typeof input.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(input.id)) return { ok: false, error: "Неверный идентификатор темы." };
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 80) return { ok: false, error: "Название темы должно содержать от 1 до 80 символов." };
  if (input.baseMode !== "dark" && input.baseMode !== "light") return { ok: false, error: "Укажите светлую или тёмную основу темы." };
  if (!plainObject(input.colors)) return { ok: false, error: "В теме отсутствует объект цветов." };
  const colors = { ...(input.baseMode === "light" ? ARCTIC_THEME : PRECISION_THEME).colors };
  for (const key of Object.keys(input.colors)) {
    if (!Object.prototype.hasOwnProperty.call(COLOR_TOKENS, key)) return { ok: false, error: "В теме есть неизвестный цвет." };
    const value = input.colors[key];
    if (typeof value !== "string" || !HEX_COLOR.test(value)) return { ok: false, error: "Цвета задаются в формате #RRGGBB." };
    colors[key as ThemeColor] = value.toLowerCase();
  }
  return { ok: true, value: { schemaVersion: 1, id: input.id, name: input.name.trim(), baseMode: input.baseMode, colors } };
}

export function exportThemeDocument(theme: ThemeDocument): string {
  const parsed = parseThemeDocument(theme);
  if (!parsed.ok) throw new Error(parsed.error);
  return JSON.stringify(parsed.value, null, 2) + "\n";
}

/** Invalid higher-priority entries do not erase a valid lower-priority preference. */
export function resolveThemeDocument(layers: {
  application?: unknown; user?: unknown; workspace?: unknown; preview?: unknown;
}): ThemeDocument | null {
  for (const value of [layers.preview, layers.workspace, layers.user, layers.application]) {
    const parsed = parseThemeDocument(value);
    if (parsed.ok) return parsed.value;
  }
  return null;
}

export function themeDocumentVariables(theme: ThemeDocument): ThemeVariables {
  const parsed = parseThemeDocument(theme);
  if (!parsed.ok) throw new Error(parsed.error);
  const variables = themeVariables("legacy");
  for (const key of Object.keys(COLOR_TOKENS) as ThemeColor[]) {
    const hex = parsed.value.colors[key];
    variables[`--kaiden-${COLOR_TOKENS[key]}`] = `${parseInt(hex.slice(1, 3), 16)} ${parseInt(hex.slice(3, 5), 16)} ${parseInt(hex.slice(5, 7), 16)}`;
  }
  variables["--kaiden-interactive-selected"] = variables["--kaiden-accent-base"];
  // The app's Tailwind classes read accent and status colours from `--orion-*`, which used to stay at the dark
  // defaults under any saved palette (gold labels and amber badges on a light surface, ~1.5:1). A palette now
  // drives them in its own scope. For the built-in Precision palette these equal the defaults, so it looks the same.
  const rgb = (hex: string): string => `${parseInt(hex.slice(1, 3), 16)} ${parseInt(hex.slice(3, 5), 16)} ${parseInt(hex.slice(5, 7), 16)}`;
  const c = parsed.value.colors;
  variables["--orion-accent"] = rgb(c.accent);
  variables["--orion-accent-hover"] = rgb(c.accentHover);
  variables["--orion-accent-foreground"] = rgb(c.accentForeground);
  variables["--orion-success"] = rgb(c.success);
  variables["--orion-warning"] = rgb(c.warning);
  variables["--orion-danger"] = rgb(c.danger);
  variables["--orion-danger-fill"] = rgb(fillUnderWhite(c.danger));
  // Inline code in the markdown editor is a pale violet on dark; on a light surface it follows the secondary text.
  if (parsed.value.baseMode === "light") variables["--orion-code-text"] = rgb(c.textSecondary);
  variables["--orion-tone-scale"] = parsed.value.baseMode === "light" ? "0.3" : "1"; // calendar tone pills
  variables["--orion-tag-l"] = parsed.value.baseMode === "light" ? "25%" : "78%"; // hue-coded project/tag labels
  if (parsed.value.baseMode === "light") {
    // The dark defaults lighten on hover, which would wash out on a light surface.
    variables["--orion-success-hover"] = rgb(c.success);
    variables["--orion-warning-hover"] = rgb(c.warning);
    variables["--orion-danger-hover"] = rgb(c.danger);
  }
  return variables;
}

function relativeLuminance(hex: string): number {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
    .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
}

/**
 * The palette's danger colour is tuned for text on the palette's surface; a solid badge with white text on it needs
 * a darker shade. Darken in small steps until white reaches 4.5:1 (a light palette's red usually already does and is
 * returned unchanged). The dominant channel darkens slowest, so a pink turns into a deeper red rather than brown.
 */
function fillUnderWhite(hex: string): string {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const top = Math.max(...channels);
  for (let k = 1; k > 0; k -= 0.02) {
    const shade = "#" + channels.map(n => Math.round(n * (n === top ? k ** 0.35 : k)).toString(16).padStart(2, "0")).join("");
    if (contrastRatio("#ffffff", shade) >= 4.5) return shade;
  }
  return "#000000";
}

/** WCAG 2 contrast ratio of two #RRGGBB colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function themeTextContrast(theme: ThemeDocument): number {
  return contrastRatio(theme.colors.textPrimary, theme.colors.surface);
}

/** Color editor keeps the accent's hover/focus/foreground coherent; imports may specify them separately. */
export function withThemeColor(theme: ThemeDocument, key: ThemeColor, hex: string): ThemeDocument {
  if (!HEX_COLOR.test(hex) || !Object.prototype.hasOwnProperty.call(COLOR_TOKENS, key)) throw new Error("Неверный цвет темы.");
  const colors = { ...theme.colors, [key]: hex.toLowerCase() };
  if (key === "accent") {
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const luminance = rgb.map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
      .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
    const darkText = luminance > 0.179;
    colors.accentForeground = darkText ? "#000000" : "#ffffff";
    colors.accentHover = "#" + rgb.map(n => Math.round(darkText ? n + (255 - n) * 0.15 : n * 0.85).toString(16).padStart(2, "0")).join("");
    colors.focus = colors.accentHover;
  }
  return { ...theme, colors };
}

export interface ThemeContrastCheck {
  id: string;
  label: string;
  ratio: number;
  /** WCAG 2 AA: 4.5 for normal text, 3 for large text and meaningful outlines. */
  minimum: number;
  /** Below the minimum on a blocking pair the theme cannot be saved: the app would become unreadable. */
  blocking: boolean;
  ok: boolean;
}

/**
 * The pairs a palette must keep readable. Body text and the accent button are blocking; secondary text, status
 * colours and outlines are reported, so a user can still save a deliberately muted theme and see what suffers.
 */
export function themeContrastChecks(theme: ThemeDocument): ThemeContrastCheck[] {
  const c = theme.colors;
  const pairs: Array<Omit<ThemeContrastCheck, "ratio" | "ok"> & { a: string; b: string }> = [
    { id: "text-surface", label: "Основной текст на поверхности", a: c.textPrimary, b: c.surface, minimum: 4.5, blocking: true },
    { id: "text-canvas", label: "Основной текст на холсте", a: c.textPrimary, b: c.canvas, minimum: 4.5, blocking: true },
    { id: "accent-button", label: "Текст на кнопке акцента", a: c.accentForeground, b: c.accent, minimum: 4.5, blocking: true },
    { id: "secondary-surface", label: "Второстепенный текст", a: c.textSecondary, b: c.surface, minimum: 4.5, blocking: false },
    { id: "subtle-surface", label: "Приглушённый текст", a: c.textSubtle, b: c.surface, minimum: 4.5, blocking: false },
    { id: "accent-surface", label: "Акцент как текст", a: c.accent, b: c.surface, minimum: 4.5, blocking: false },
    { id: "danger-surface", label: "Текст ошибки", a: c.danger, b: c.surface, minimum: 4.5, blocking: false },
    { id: "border-surface", label: "Заметная граница", a: c.borderStrong, b: c.surface, minimum: 3, blocking: false },
    { id: "focus-surface", label: "Рамка фокуса", a: c.focus, b: c.surface, minimum: 3, blocking: false }
  ];
  return pairs.map(({ a, b, ...pair }) => {
    const ratio = contrastRatio(a, b);
    return { ...pair, ratio, ok: ratio >= pair.minimum };
  });
}

/** Human-readable reason the theme can't be saved, or null when every blocking pair passes. */
export function themeBlockingContrastIssue(theme: ThemeDocument): string | null {
  const failed = themeContrastChecks(theme).find(check => check.blocking && !check.ok);
  return failed ? `${failed.label}: ${failed.ratio.toFixed(1)}:1, нужно не меньше ${failed.minimum}:1.` : null;
}

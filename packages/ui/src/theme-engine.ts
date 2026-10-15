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
    border: "#414248", borderStrong: "#62636a", accent: "#c9a86a", accentHover: "#dec08b",
    accentForeground: "#16171a", focus: "#dec08b", success: "#10b981", warning: "#f59e0b",
    danger: "#f43f5e", info: "#60a5fa", tint: "#ffffff"
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
  return variables;
}

export function themeTextContrast(theme: ThemeDocument): number {
  const luminance = (hex: string): number => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
    .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
  const a = luminance(theme.colors.textPrimary), b = luminance(theme.colors.surface);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
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

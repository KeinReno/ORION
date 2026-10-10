import type { UserPreference } from "@orion/shared-types";

/** Swatch hex per accent — mirrors the `--orion-accent` values in globals.css, for the picker dots only. */
export const ACCENT_HEX: Record<UserPreference["accent"], string> = {
  violet: "#5b5ee8",
  blue: "#2563eb",
  green: "#22c55e",
  amber: "#f59e0b",
  rose: "#e11d48"
};
const ACCENT_LABEL: Record<UserPreference["accent"], string> = {
  violet: "Фиолетовый",
  blue: "Синий",
  green: "Зелёный",
  amber: "Янтарный",
  rose: "Розовый"
};
export const ACCENT_OPTIONS = (Object.keys(ACCENT_HEX) as UserPreference["accent"][]).map((value) => ({
  value,
  label: (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: ACCENT_HEX[value] }} aria-hidden />
      {ACCENT_LABEL[value]}
    </span>
  )
}));

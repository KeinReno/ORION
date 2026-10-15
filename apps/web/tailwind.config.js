/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./panels/**/*.{ts,tsx}",
    "./plugins/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
    "../../packages/core-react/src/**/*.{ts,tsx}"
  ],
  darkMode: "class",
  theme: {
    extend: {
      /**
       * ORION design tokens. One dark theme (the app always renders inside
       * dockview's `themeAbyss`), so plain hex — with one deliberate
       * exception: `accent` is a CSS variable, because the user's accent
       * preference has to take effect at runtime without a rebuild. The
       * channel form (`R G B`) keeps Tailwind's `/opacity` modifier working,
       * and `:root` in globals.css defaults it to the exact violet that used
       * to be hardcoded here.
       * Names follow the shadcn/ui vocabulary so component code reads the
       * same as the reference library.
       */
      colors: {
        // KAIDEN v1: additive bridge; existing utility names keep their legacy values.
        "ui-button": "rgb(var(--kaiden-button-bg) / <alpha-value>)",
        "ui-button-foreground": "rgb(var(--kaiden-button-fg) / <alpha-value>)",
        "ui-accent-hover": "rgb(var(--kaiden-accent-hover) / <alpha-value>)",
        "ui-focus": "rgb(var(--kaiden-focus-ring) / <alpha-value>)",
        "ui-header": "rgb(var(--kaiden-panel-header-bg) / <alpha-value>)",
        "ui-primary": "rgb(var(--kaiden-text-primary) / <alpha-value>)",
        "ui-secondary": "rgb(var(--kaiden-text-secondary) / <alpha-value>)",
        "ui-subtle": "rgb(var(--kaiden-text-subtle) / <alpha-value>)",
        "ui-tint": "rgb(var(--kaiden-tint-base) / <alpha-value>)",
        "ui-success": "rgb(var(--kaiden-status-success) / <alpha-value>)",
        "ui-danger": "rgb(var(--kaiden-status-danger) / <alpha-value>)",
        "ui-border": "rgb(var(--kaiden-border-default) / <alpha-value>)",
        "ui-border-strong": "rgb(var(--kaiden-border-strong) / <alpha-value>)",
        "ui-hover": "rgb(var(--kaiden-bg-hover) / <alpha-value>)",
        "ui-overlay": "rgb(var(--kaiden-overlay-bg) / <alpha-value>)",
        "ui-overlay-border": "rgb(var(--kaiden-overlay-border) / <alpha-value>)",
        background: "#0a0a0c",
        panel: "#0d0d11",
        card: "#141419",
        "card-hover": "#1a1a21",
        border: "#2c2c35",
        "border-strong": "#3c3c47",
        foreground: "#f4f4f5",
        "muted-foreground": "#a1a1aa",
        // Was #71717a (4.0:1 on the panel — below the 4.5:1 AA floor for small text); 5.4:1 now.
        "subtle-foreground": "#8a8a94",
        accent: "rgb(var(--orion-accent) / <alpha-value>)",
        "accent-hover": "rgb(var(--orion-accent-hover) / <alpha-value>)",
        // Text ON an accent fill (white, or near-black for the light green/amber accents).
        "accent-foreground": "rgb(var(--orion-accent-foreground) / <alpha-value>)",
        // Accent-coloured TEXT on a dark surface: the lighter accent shade, which clears 4.5:1
        // where the fill colour itself (4.3:1) does not.
        "accent-text": "rgb(var(--orion-accent-hover) / <alpha-value>)",
        destructive: "rgb(var(--orion-danger) / <alpha-value>)",
        "destructive-hover": "rgb(var(--orion-danger-hover) / <alpha-value>)",
        success: "rgb(var(--orion-success) / <alpha-value>)",
        "success-hover": "rgb(var(--orion-success-hover) / <alpha-value>)",
        warning: "rgb(var(--orion-warning) / <alpha-value>)",
        "warning-hover": "rgb(var(--orion-warning-hover) / <alpha-value>)"
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        display: ["var(--font-display)", { lineHeight: "1.2", fontWeight: "600" }],
        title: ["var(--font-title)", { lineHeight: "1.3", fontWeight: "600" }],
        body: ["var(--font-body)", { lineHeight: "1.5" }],
        label: ["var(--font-label)", { lineHeight: "1.4", fontWeight: "500" }],
        micro: ["var(--font-micro)", { lineHeight: "1rem", letterSpacing: "0.06em", fontWeight: "500" }]
      },
      spacing: {
        "ui-panel": "var(--kaiden-panel-padding)",
        "ui-panel-gap": "var(--kaiden-panel-gap)",
        row: "var(--orion-row-py)",
        "card-row": "var(--orion-card-row-py)"
      },
      borderRadius: {
        "ui-button": "var(--kaiden-button-radius)"
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" }
        }
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out",
        "slide-up": "slide-up 0.2s ease-out",
        "scale-in": "scale-in 0.14s ease-out"
      }
    }
  },
  plugins: []
};

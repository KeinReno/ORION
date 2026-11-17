import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.next-*/**",
      "**/out/**",
      "**/target/**",
      "**/.tmp/**", // Local scratch builds are not source files.
      "**/.tmp-*/**", // Root scratch dirs: .tmp-build/.tmp-test/.tmp-bin.
      ".tools/**", // Self-hosted runner + local toolchain, not source.
      ".pnpm-store/**", // Local pnpm store.
      "tmp/**", // Local build/extraction artifacts, never source code.
      "apps/compass-engine/**",
      "splash/_chromeprofile/**", // Одноразовый профиль Chromium для съёмки splash, не исходники
      "**/src-tauri/gen/**",
      "**/src-tauri/resources/**",
      "**/generated/**",
      // Vendored pdf.js worker, copied into public/ by copy-pdf-worker.mjs.
      "apps/web/public/**",
      "**/*.config.js",
      "**/*.config.mjs"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn"
    }
  }
);

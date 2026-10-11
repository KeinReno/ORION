import { defineConfig } from "vitest/config";

// Fast, no-DB unit tests over pure logic in packages/ (schemas, ApiClient
// retry/rotation, TokenStore), plus a few framework-free modules under
// apps/web/lib/ (e.g. panel-bus's intent-channel core, S09) that are worth
// unit-testing without pulling in jsdom/testing-library for the whole app.
// scripts/*.test.mjs covers the same kind of framework-free logic that
// backs the desktop launcher (S18 readiness polling) — no Tauri/child_process
// runtime needed to exercise it.
// NestJS service / DB-integration tests are a separate future setup — the
// manual "Проверка" checklists in docs/HISTORY.md still cover those paths for now.
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/web/lib/**/*.test.ts", "apps/api/src/**/*.test.ts", "scripts/**/*.test.mjs"],
    environment: "node"
  }
});

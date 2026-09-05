import { defineConfig } from "vitest/config";

// Fast, no-DB unit tests over pure logic in packages/ (schemas, ApiClient
// retry/rotation, TokenStore). NestJS service / DB-integration tests are a
// separate future setup — the manual "Проверка" checklists in docs/PLAN.md
// still cover those paths for now.
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts"],
    environment: "node"
  }
});

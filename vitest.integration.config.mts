import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/api/**/*.integration.test.ts"],
    environment: "node",
    fileParallelism: false,
    setupFiles: ["apps/api/test/setup-integration.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});

import { defineConfig, devices } from "@playwright/test";

/**
 * Browser check for the experiment only. It does not start servers and does not
 * use the beta ports. Point it at the already running ORION-R dev stack:
 * web http://localhost:3011, API E2E_API_PORT=14000.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "nav-sidebars.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3011",
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});

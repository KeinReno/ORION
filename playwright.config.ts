import { defineConfig, devices } from "@playwright/test";

// Browser smoke / parity suite (e2e/). It runs against the *production* builds
// (`pnpm build` first): the API from apps/api/dist and `next start` for the web
// client, both started here. Ports and database come from the environment so
// the suite never collides with a dev instance:
//   CI          — the job's fresh Postgres, ports 4000/3010 (the web build's
//                 loopback fallback already points at :4000);
//   locally     — `pnpm test:e2e:local` (scripts/e2e-local.mjs) recreates a
//                 separate `orion_e2e` database and uses ports 4100/3110.
const apiPort = Number(process.env.E2E_API_PORT ?? 4000);
const webPort = Number(process.env.E2E_WEB_PORT ?? 3010);
const webOrigin = `http://localhost:${webPort}`;
const apiEnv: Record<string, string> = {
  PORT: String(apiPort),
  WEB_ORIGIN: webOrigin,
  ORION_MODE: "local",
  STORAGE_DRIVER: "local",
  STORAGE_DIR: "../../tmp/e2e-documents",
  // Every spec registers its own accounts from 127.0.0.1; the suite outgrew the 60-per-5-minutes production cap.
  REGISTER_RATE_LIMIT_PER_IP: "10000",
  // ADR-0022: extensions and their approvals live in throwaway folders, never in the developer's Documents or node dir.
  ORION_EXTENSIONS_DIR: "../../tmp/e2e-extensions",
  ORION_NODE_DIR: "../../tmp/e2e-node"
};
if (process.env.E2E_DATABASE_URL) apiEnv.DATABASE_URL = process.env.E2E_DATABASE_URL;
if (process.env.E2E_APP_DATABASE_URL) apiEnv.APP_DATABASE_URL = process.env.E2E_APP_DATABASE_URL;

export default defineConfig({
  testDir: "e2e",
  // Text snapshots (action inventories) are platform-independent, so one
  // baseline serves Windows dev machines and the Linux CI runner alike.
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFileName}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : [["list"]],
  outputDir: "test-results/e2e",
  use: {
    baseURL: webOrigin,
    viewport: { width: 1280, height: 800 },
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  metadata: { apiUrl: `http://localhost:${apiPort}` },
  webServer: [
    {
      command: "node dist/main.js",
      cwd: "apps/api",
      url: `http://127.0.0.1:${apiPort}/system/health`,
      env: apiEnv,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe"
    },
    {
      command: `node node_modules/next/dist/bin/next start --port ${webPort}`,
      cwd: "apps/web",
      url: `${webOrigin}/login`,
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});

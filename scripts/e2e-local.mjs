// Local run of the browser smoke suite: `pnpm test:e2e:local [--skip-build] [playwright args…]`.
//
// 1. recreates the separate `orion_e2e` database (scripts/e2e-db.mjs) — the
//    shared dev database on :5433 is never touched;
// 2. builds the API and the web client, the latter with NEXT_PUBLIC_API_URL
//    pointing at the e2e API port (skip with --skip-build when nothing changed);
// 3. runs Playwright on ports 4100/3110 so a running dev instance on 4000/3010
//    keeps working. Extra arguments go to Playwright (e.g. --update-snapshots).
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { e2eUrls } from "./e2e-db.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const passThrough = args.filter((arg) => arg !== "--skip-build");
const apiPort = process.env.E2E_API_PORT ?? "4100";
const webPort = process.env.E2E_WEB_PORT ?? "3110";
const shell = process.platform === "win32";

function run(command, commandArgs, env = {}) {
  execFileSync(command, commandArgs, { cwd: root, stdio: "inherit", shell, env: { ...process.env, ...env } });
}

run("node", ["scripts/e2e-db.mjs"]);
if (!skipBuild) {
  run("corepack", ["pnpm", "--filter", "@orion/api", "build"]);
  run("corepack", ["pnpm", "--filter", "@orion/web", "build"], { NEXT_PUBLIC_API_URL: `http://localhost:${apiPort}` });
}
const urls = e2eUrls();
run("corepack", ["pnpm", "exec", "playwright", "test", ...passThrough], {
  E2E_API_PORT: apiPort,
  E2E_WEB_PORT: webPort,
  E2E_DATABASE_URL: urls.migrate,
  E2E_APP_DATABASE_URL: urls.app
});

#!/usr/bin/env node
/**
 * QA-01: six independent, ordered local QA stages for beta37.
 *
 * Usage:
 *   node scripts/qa-local.mjs --only=static,architecture,unit,build
 *   node scripts/qa-local.mjs --db-name=orion_qa_gpt --confirm-reset=orion_qa_gpt
 *
 * With database stages, set DATABASE_URL and APP_DATABASE_URL explicitly to
 * localhost admin/app-role connections for the EXISTING development cluster.
 * Only the explicitly named throwaway orion_qa_* database is recreated.
 * Never point this runner at a real user's database or a remote PostgreSQL host.
 *
 * Exit 0: all requested stages passed. 1: a stage failed. 2: one or more
 * requested stages were blocked. Not-requested stages are NOT_RUN.
 */
import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync, writeSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { validateQaDatabaseConfig } from "./qa-preflight.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STAGES = ["static", "architecture", "unit", "integration", "browser", "build"];
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  if (!arg.startsWith("--")) throw new Error("Unexpected argument: " + arg);
  const eq = arg.indexOf("=");
  return eq === -1 ? [arg.slice(2), "true"] : [arg.slice(2, eq), arg.slice(eq + 1)];
}));
const requested = options.only ? options.only.split(",") : STAGES;
if (requested.some((item) => !STAGES.includes(item))) throw new Error("Invalid --only stage");
const outputDir = resolve(root, options["output-dir"] || "tmp/qa-reports");
mkdirSync(outputDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportDir = resolve(outputDir, stamp);
mkdirSync(reportDir, { recursive: true });
const summary = {
  base: "821e694370f44485442edcdfe83de23709b1a8d8",
  createdAt: new Date().toISOString(),
  platform: process.platform,
  stages: STAGES.map((id) => ({ id, status: "NOT_RUN", steps: [] }))
};
const pnpm = (args) => ({ command: "corepack", args: ["pnpm", ...args] });
const node = (args) => ({ command: process.execPath, args });
const commands = {
  static: [pnpm(["typecheck"]), pnpm(["lint"])],
  architecture: [pnpm(["architecture-check"]), pnpm(["platform-map:check"]), pnpm(["plugin-contract-check"])],
  unit: [pnpm(["test:unit"])],
  integration: [node(["scripts/e2e-db.mjs"]), pnpm(["test:integration"])],
  browser: [pnpm(["test:e2e:local"])],
  build: [pnpm(["build"])]
};

function persist() {
  writeFileSync(resolve(reportDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  const lines = [
    "# ORION QA local report",
    "",
    "Baseline: " + summary.base,
    "Host platform: " + summary.platform,
    "Time: " + summary.createdAt,
    "",
    "| Stage | Result | Steps |",
    "|---|---|---|"
  ];
  for (const stage of summary.stages) {
    lines.push("| " + stage.id + " | " + stage.status + " | " +
      stage.steps.map((step) => step.name + ": " + step.status + " (" + step.exitCode + ")").join("; ") + " |");
  }
  lines.push("", "Browser, Windows and PostgreSQL tests are PASS only when the corresponding commands actually exited with code 0.",
    "NOT_RUN does not mean PASS. BLOCKED means prerequisites were not satisfied.",
    "");
  writeFileSync(resolve(reportDir, "summary.md"), lines.join("\n"));
}

async function execute(stageId, index, command, env) {
  const name = command.command + " " + command.args.join(" ");
  const logPath = resolve(reportDir, stageId + "-" + String(index + 1).padStart(2, "0") + ".log");
  const fd = openSync(logPath, "w");
  const started = Date.now();
  console.log("[QA]", stageId, name);
  try {
    const code = await new Promise((done, reject) => {
      const child = spawn(command.command, command.args, {
        cwd: root, env, shell: process.platform === "win32", windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      child.stdout.on("data", (chunk) => { writeSync(fd, chunk); process.stdout.write(chunk); });
      child.stderr.on("data", (chunk) => { writeSync(fd, chunk); process.stderr.write(chunk); });
      child.on("error", reject);
      child.on("close", (exitCode) => done(exitCode ?? 1));
    });
    return { name, status: code === 0 ? "PASS" : "FAIL", exitCode: code, durationMs: Date.now() - started, log: logPath };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    writeSync(fd, reason + "\n");
    return { name, status: "BLOCKED", exitCode: null, durationMs: Date.now() - started, log: logPath, reason };
  } finally { closeSync(fd); }
}

let dbEnv;
let dbBlocker = "";
if (requested.some((stage) => stage === "integration" || stage === "browser")) {
  try {
    const safe = validateQaDatabaseConfig({
      databaseUrl: process.env.DATABASE_URL,
      appDatabaseUrl: process.env.APP_DATABASE_URL,
      dbName: options["db-name"],
      confirmReset: options["confirm-reset"]
    });
    dbEnv = {
      ...process.env,
      DATABASE_URL: safe.databaseUrl,
      APP_DATABASE_URL: safe.appDatabaseUrl,
      E2E_DATABASE: safe.dbName,
      E2E_DATABASE_URL: safe.databaseUrl,
      E2E_APP_DATABASE_URL: safe.appDatabaseUrl
    };
    // scripts/e2e-db.mjs needs the admin connection to an EXISTING database.
    dbEnv.DATABASE_URL = process.env.DATABASE_URL;
    dbEnv.APP_DATABASE_URL = process.env.APP_DATABASE_URL;
  } catch (error) { dbBlocker = error instanceof Error ? error.message : String(error); }
}

for (const stage of summary.stages) {
  if (!requested.includes(stage.id)) continue;
  if ((stage.id === "integration" || stage.id === "browser") && dbBlocker) {
    stage.status = "BLOCKED";
    stage.reason = dbBlocker;
    console.error("[QA] BLOCKED", stage.id, dbBlocker);
    persist();
    continue;
  }
  stage.status = "PASS";
  for (const [index, cmd] of commands[stage.id].entries()) {
    const env = stage.id === "integration" || stage.id === "browser" ? { ...dbEnv } : { ...process.env };
    if (stage.id === "integration" && index > 0) {
      const qaDb = options["db-name"];
      const forQa = (url) => {
        const parsed = new URL(url);
        parsed.pathname = "/" + qaDb;
        return parsed.toString();
      };
      env.DATABASE_URL = forQa(process.env.DATABASE_URL);
      env.APP_DATABASE_URL = forQa(process.env.APP_DATABASE_URL);
    }
    const result = await execute(stage.id, index, cmd, env);
    stage.steps.push(result);
    if (result.status !== "PASS") { stage.status = result.status; break; }
  }
  persist();
}
persist();
console.log("[QA] Report:", resolve(reportDir, "summary.md"));
const statuses = summary.stages.filter((x) => requested.includes(x.id)).map((x) => x.status);
process.exitCode = statuses.includes("FAIL") ? 1 : statuses.includes("BLOCKED") ? 2 : 0;

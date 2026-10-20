#!/usr/bin/env node
/**
 * ORION MCP server for a SOURCE CHECKOUT. The adapter itself lives in `apps/api/src/mcp/orion-mcp.ts`; its tool list is
 * generated from the shared catalogue (`AGENT_TOOLS`), so this file has none of its own. The installed app ships the
 * compiled adapter instead (`runtime/api/dist/mcp/orion-mcp.js`, run with the bundled node.exe) — no Node, repo or paths
 * needed there: Настройки → ИИ и агенты → «Подключить агента» prints the exact command.
 *
 *   ORION_AGENT_TOKEN=orion_agt_…  [ORION_API_URL=http://127.0.0.1:4000]  node scripts/orion-mcp.mjs
 *
 * Uses the compiled adapter when `pnpm --filter @orion/api build` has produced it; otherwise runs the TypeScript source
 * through ts-node (transpile only, same as `pnpm dev:api`).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(root, "apps", "api");
const compiled = join(apiDir, "dist", "mcp", "orion-mcp.js");
const source = join(apiDir, "src", "mcp", "orion-mcp.ts");

const args = existsSync(compiled)
  ? [compiled, ...process.argv.slice(2)]
  : ["-r", "ts-node/register/transpile-only", "-r", "tsconfig-paths/register", source, ...process.argv.slice(2)];

// stdio is inherited: stdin/stdout stay the MCP protocol channel, stderr the log.
const child = spawn(process.execPath, args, { cwd: apiDir, stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  process.stderr.write(`[orion-mcp] не удалось запустить: ${error.message}\n`);
  process.exit(1);
});

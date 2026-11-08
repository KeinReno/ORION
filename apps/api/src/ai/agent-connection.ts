import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AgentConnectionInfo } from "@orion/shared-types";
import { isServerMode } from "../common/orion-mode";
import { loadNodeConfig } from "../lan/node-config";
import { aiBridgeDisabledReason, aiBridgeEnabled, aiBridgeOverrideEditableBy } from "./agent-tokens.service";

/**
 * Where the MCP adapter and the Agent Manual live for the process that is running right now. The API is the only
 * place that knows: in the packaged app it runs under the bundled `node.exe` next to a compiled `dist/`, so
 * `process.execPath` and `__dirname` ARE the real installed paths (TZ-02, 2.5/2.6). Pure and injectable for tests.
 */
export function resolveAgentConnection(
  options: { baseDir?: string; execPath?: string; env?: NodeJS.ProcessEnv; exists?: (path: string) => boolean; server?: boolean; userId?: string } = {}
): AgentConnectionInfo {
  const baseDir = options.baseDir ?? __dirname;
  const execPath = options.execPath ?? process.execPath;
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const server = options.server ?? isServerMode();

  // dist/ai → dist/mcp/orion-mcp.js (packaged app and `pnpm build`)
  const adapter = resolve(baseDir, "..", "mcp", "orion-mcp.js");
  // apps/api/src/ai → scripts/orion-mcp.mjs (source checkout under ts-node)
  const shim = resolve(baseDir, "..", "..", "..", "..", "scripts", "orion-mcp.mjs");
  const launcher: AgentConnectionInfo["launcher"] = exists(adapter) ? "installed" : exists(shim) ? "repo" : "unavailable";
  const entry = launcher === "installed" ? adapter : launcher === "repo" ? shim : null;

  const manualCandidates = [
    env.ORION_AGENT_MANUAL_PATH,
    // packaged: <runtime>/api/dist/ai → <runtime>/AGENT_MANUAL.md
    join(dirname(resolve(baseDir, "..", "..")), "AGENT_MANUAL.md"),
    resolve(baseDir, "..", "..", "..", "..", "docs", "AGENT_MANUAL.md")
  ].filter((value): value is string => Boolean(value));

  const port = env.PORT?.trim() || "14000";
  return {
    bridgeEnabled: aiBridgeEnabled(),
    bridgeDisabledReason: aiBridgeDisabledReason(),
    bridgeOverride: loadNodeConfig().aiBridgeOverride,
    bridgeOverrideEditable: options.userId !== undefined && aiBridgeOverrideEditableBy(options.userId),
    mode: server ? "server" : "local",
    apiUrl: env.ORION_PUBLIC_API_URL?.trim().replace(/\/+$/, "") || (server ? null : `http://127.0.0.1:${port}`),
    launcher,
    // A server install is reached remotely: a path on that machine would be wrong for the agent's own computer.
    command: entry && !server ? execPath : null,
    args: entry && !server ? [entry] : [],
    manualPath: server ? null : (manualCandidates.find((path) => exists(path)) ?? null)
  };
}

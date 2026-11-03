import fs from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { AgentInstallClient } from "@orion/shared-types";

/**
 * «Подключить в один клик»: ORION writes itself into the MCP configuration of the user's AI program (Claude Desktop,
 * Claude Code, Cursor, Codex) on THIS computer, so an agent running on the user's own subscription works in ORION
 * without copying a token by hand. Pure helpers (paths, merging) are separate from the file write for tests.
 *
 * Rules: only the `orion` entry is added or replaced, everything else in the file stays as it was; a file that cannot
 * be parsed is never overwritten (the user gets the manual snippet instead); the previous file is kept as a backup.
 */

export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The server name in every client's config. One ORION per computer: connecting another workspace replaces it. */
export const MCP_SERVER_NAME = "orion";

export function clientConfigPath(
  client: AgentInstallClient,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
  platform: NodeJS.Platform = process.platform
): string {
  // Tests point the whole lookup at a scratch folder instead of the real profile.
  const testHome = env.ORION_AGENT_CLIENT_HOME?.trim();
  if (testHome) {
    home = testHome;
    env = { ...env, APPDATA: path.join(testHome, "AppData", "Roaming"), XDG_CONFIG_HOME: undefined, CODEX_HOME: undefined };
  }
  switch (client) {
    case "claude-desktop":
      if (platform === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
      if (platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "Claude", "claude_desktop_config.json");
    case "claude-code":
      // User scope of Claude Code's MCP servers.
      return path.join(home, ".claude.json");
    case "cursor":
      return path.join(home, ".cursor", "mcp.json");
    case "codex":
      return path.join(env.CODEX_HOME || path.join(home, ".codex"), "config.toml");
  }
}

export const CLIENT_RESTART_HINT: Record<AgentInstallClient, string> = {
  "claude-desktop": "Перезапустите Claude Desktop (закройте его и из трея) — ORION появится в списке инструментов.",
  "claude-code": "Перезапустите Claude Code — команда /mcp покажет сервер «orion».",
  cursor: "Перезапустите Cursor — ORION появится в Settings → MCP.",
  codex: "Перезапустите Codex — сервер «orion» подхватится из config.toml."
};

/** Adds or replaces `mcpServers.orion` in a JSON config; throws on a file that is not a JSON object. */
export function mergeMcpJson(existing: string | null, entry: McpServerEntry): string {
  let config: Record<string, unknown> = {};
  if (existing !== null && existing.trim() !== "") {
    const parsed: unknown = JSON.parse(existing);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("файл настроек — не JSON-объект");
    config = parsed as Record<string, unknown>;
  }
  const current = config.mcpServers;
  const servers = current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
  config.mcpServers = { ...servers, [MCP_SERVER_NAME]: entry };
  return `${JSON.stringify(config, null, 2)}\n`;
}

const tomlString = (value: string): string => JSON.stringify(value);

/** Replaces the `[mcp_servers.orion]` table (and its sub-tables) of a Codex config.toml, keeping everything else. */
export function mergeCodexToml(existing: string | null, entry: McpServerEntry): string {
  const lines = (existing ?? "").split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line);
    if (header) {
      const name = header[1]!.replace(/\s+/g, "");
      skipping = name === `mcp_servers.${MCP_SERVER_NAME}` || name.startsWith(`mcp_servers.${MCP_SERVER_NAME}.`);
    }
    if (!skipping) kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1]!.trim() === "") kept.pop();
  const env = Object.entries(entry.env).map(([key, value]) => `${key} = ${tomlString(value)}`).join(", ");
  const block = [
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(", ")}]`,
    `env = { ${env} }`
  ];
  return `${[...kept, ...(kept.length > 0 ? [""] : []), ...block].join("\n")}\n`;
}

export function mergeClientConfig(client: AgentInstallClient, existing: string | null, entry: McpServerEntry): string {
  return client === "codex" ? mergeCodexToml(existing, entry) : mergeMcpJson(existing, entry);
}

/** Writes the merged config: backup of the previous file next to it, then an atomic replace. Returns the backup path. */
/** Credential lives outside MCP config, so Codex/Cursor settings and their backups never
 * contain the live bearer secret. The adapter already reads ORION_AGENT_TOKEN_FILE.
 * This must be the same OS user's profile as the MCP client.
 */
export function agentTokenFilePath(client: AgentInstallClient, configPath: string): string {
  return path.join(path.dirname(configPath), `.orion-${client}-agent.token`);
}

/** Atomic replacement, owner-only permissions on POSIX; Windows inherits profile ACLs. */
export function writePrivateAgentToken(file: string, token: string): void {
  if (!/^orion_agt_[A-Za-z0-9_-]{32}$/.test(token)) throw new Error("Invalid agent token");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) throw new Error("Token path is not a regular file");
  const tmp = `${file}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, token + "\\n", { mode: 0o600, flag: "wx" });
    if (process.platform !== "win32") fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

export function writeClientConfig(file: string, content: string, now: Date = new Date()): string | null {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup: string | null = null;
  if (fs.existsSync(file)) {
    backup = `${file}.orion-backup-${now.toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(file, backup);
    if (process.platform !== "win32") fs.chmodSync(backup, 0o600);
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, file);
  return backup;
}

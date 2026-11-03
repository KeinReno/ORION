import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentTokenFilePath, clientConfigPath, mergeCodexToml, mergeMcpJson, writeClientConfig, writePrivateAgentToken, type McpServerEntry } from "./agent-client-install";

const entry: McpServerEntry = { command: "C:\\ORION\\node.exe", args: ["C:\\ORION\\api\\dist\\mcp\\orion-mcp.js"], env: { ORION_AGENT_TOKEN: "oat_x", ORION_API_URL: "http://127.0.0.1:4000" } };

describe("agent client install", () => {
  it("knows where each program keeps its MCP servers", () => {
    expect(clientConfigPath("claude-desktop", { APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "C:\\Users\\u", "win32")).toBe(path.join("C:\\Users\\u\\AppData\\Roaming", "Claude", "claude_desktop_config.json"));
    expect(clientConfigPath("claude-desktop", {}, "/Users/u", "darwin")).toBe(path.join("/Users/u", "Library", "Application Support", "Claude", "claude_desktop_config.json"));
    expect(clientConfigPath("claude-code", {}, "/home/u", "linux")).toBe(path.join("/home/u", ".claude.json"));
    expect(clientConfigPath("cursor", {}, "/home/u", "linux")).toBe(path.join("/home/u", ".cursor", "mcp.json"));
    expect(clientConfigPath("codex", { CODEX_HOME: "/x/codex" }, "/home/u", "linux")).toBe(path.join("/x/codex", "config.toml"));
  });

  it("adds orion to a JSON config and keeps everything else", () => {
    const existing = JSON.stringify({ theme: "dark", mcpServers: { github: { command: "gh" }, orion: { command: "old" } } });
    const merged = JSON.parse(mergeMcpJson(existing, entry));
    expect(merged.theme).toBe("dark");
    expect(merged.mcpServers.github).toEqual({ command: "gh" });
    expect(merged.mcpServers.orion).toEqual(entry);
    expect(JSON.parse(mergeMcpJson(null, entry))).toEqual({ mcpServers: { orion: entry } });
  });

  it("refuses to rewrite a file it cannot read", () => {
    expect(() => mergeMcpJson("{ broken", entry)).toThrow();
    expect(() => mergeMcpJson("[1, 2]", entry)).toThrow(/не JSON-объект/);
  });

  it("replaces only the orion table in a Codex config", () => {
    const existing = [
      'model = "o4"',
      "",
      "[mcp_servers.github]",
      'command = "gh"',
      "",
      "[mcp_servers.orion]",
      'command = "old"',
      "[mcp_servers.orion.env]",
      'ORION_AGENT_TOKEN = "old"',
      "",
      "[profiles.fast]",
      'model = "mini"'
    ].join("\n");
    const merged = mergeCodexToml(existing, entry);
    expect(merged).toContain("[mcp_servers.github]");
    expect(merged).toContain("[profiles.fast]");
    expect(merged).not.toContain('"old"');
    expect(merged.match(/\[mcp_servers\.orion\]/g)).toHaveLength(1);
    expect(merged).toContain('command = "C:\\\\ORION\\\\node.exe"');
    expect(merged).toContain('env = { ORION_AGENT_TOKEN = "oat_x", ORION_API_URL = "http://127.0.0.1:4000" }');
  });

  it("keeps a backup of the previous file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-install-"));
    const file = path.join(dir, "Claude", "claude_desktop_config.json");
    expect(writeClientConfig(file, "{}\n")).toBeNull();
    const backup = writeClientConfig(file, '{"a":1}\n', new Date("2026-10-20T12:00:00Z"));
    expect(backup && fs.readFileSync(backup, "utf8")).toBe("{}\n");
    expect(fs.readFileSync(file, "utf8")).toBe('{"a":1}\n');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("stores the live secret outside Codex MCP config and restricts the private file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-credential-"));
    try {
      const configPath = path.join(dir, ".codex", "config.toml");
      const tokenPath = agentTokenFilePath("codex", configPath);
      const secret = "orion_agt_" + "a".repeat(32);
      writePrivateAgentToken(tokenPath, secret);
      const merged = mergeCodexToml(null, {
        command: "node", args: ["adapter.js"],
        env: { ORION_AGENT_TOKEN_FILE: tokenPath, ORION_API_URL: "http://127.0.0.1:4000" }
      });
      expect(merged).toContain("ORION_AGENT_TOKEN_FILE");
      expect(merged).not.toContain(secret);
      expect(fs.readFileSync(tokenPath, "utf8").trim()).toBe(secret);
      if (process.platform !== "win32") expect(fs.statSync(tokenPath).mode & 0o077).toBe(0);
      expect(() => writePrivateAgentToken(tokenPath, "not-a-token")).toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses invalid mcpServers values rather than silently discarding other settings", () => {
    expect(() => mergeMcpJson('{"mcpServers":[]}', entry)).toThrow(/mcpServers/);
    expect(() => mergeMcpJson('{"mcpServers":null}', entry)).toThrow(/mcpServers/);
  });

});

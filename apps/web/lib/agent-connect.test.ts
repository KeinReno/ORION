import type { AgentConnectionInfo } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { buildConnectSnippet, checkAgentConnection } from "./agent-connect";

const SECRET = "orion_agt_abc123";
const installed: AgentConnectionInfo = {
  bridgeEnabled: true,
  bridgeDisabledReason: null,
  bridgeOverride: null,
  bridgeOverrideEditable: false,
  mode: "local",
  apiUrl: "http://127.0.0.1:4000",
  launcher: "installed",
  command: "C:\\Program Files\\ORION\\runtime\\node.exe",
  args: ["C:\\Program Files\\ORION\\runtime\\api\\dist\\mcp\\orion-mcp.js"],
  manualPath: null
};

describe("buildConnectSnippet", () => {
  it("Claude Desktop и Cursor: валидный JSON с реальными путями установки", () => {
    for (const client of ["claude-desktop", "cursor"] as const) {
      const snippet = buildConnectSnippet(client, installed, SECRET)!;
      const parsed = JSON.parse(snippet.text) as { mcpServers: { orion: { command: string; args: string[]; env: Record<string, string> } } };
      expect(parsed.mcpServers.orion.command).toBe(installed.command);
      expect(parsed.mcpServers.orion.args).toEqual(installed.args);
      expect(parsed.mcpServers.orion.env).toEqual({ ORION_AGENT_TOKEN: SECRET, ORION_API_URL: "http://127.0.0.1:4000" });
    }
  });

  it("Claude Code: команда с кавычками вокруг путей с пробелами", () => {
    const text = buildConnectSnippet("claude-code", installed, SECRET)!.text;
    expect(text).toContain(`-e ORION_AGENT_TOKEN=${SECRET}`);
    expect(text).toContain('"C:\\Program Files\\ORION\\runtime\\node.exe"');
  });

  it("Codex: TOML со строками в двойных кавычках и экранированными слэшами", () => {
    const text = buildConnectSnippet("codex", installed, SECRET)!.text;
    expect(text).toContain("[mcp_servers.orion]");
    expect(text).toContain('command = "C:\\\\Program Files\\\\ORION\\\\runtime\\\\node.exe"');
  });

  it("«другой» работает и без MCP; остальные без адаптера — null", () => {
    const server: AgentConnectionInfo = { ...installed, mode: "server", launcher: "unavailable", command: null, args: [], apiUrl: null };
    expect(buildConnectSnippet("other", server, SECRET)!.text).toContain("/ai/v1/context");
    expect(buildConnectSnippet("cursor", server, SECRET)).toBeNull();
  });
});

describe("checkAgentConnection", () => {
  it("успех, 401 и обрыв связи", async () => {
    const ok = (async () => new Response(JSON.stringify({ tokenName: "Claude", scopes: ["a", "b"] }))) as unknown as typeof fetch;
    const unauthorized = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    const down = (async () => {
      throw new Error("x");
    }) as unknown as typeof fetch;
    expect(await checkAgentConnection("http://h/", SECRET, ok)).toEqual({ ok: true, message: "Работает: токен «Claude», разрешений: 2." });
    expect((await checkAgentConnection("http://h", SECRET, unauthorized)).ok).toBe(false);
    expect((await checkAgentConnection("http://h", SECRET, down)).message).toContain("Нет связи");
  });
});

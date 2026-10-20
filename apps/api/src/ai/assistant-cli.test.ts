import { describe, expect, it } from "vitest";
import { cliFailure, cmdQuote, codexArgs, cursorArgs, cursorMcpJson, findCliBinary } from "./assistant-cli";

const mcp = { command: "C:\\Program Files\\ORION\\node.exe", args: ["C:\\Program Files\\ORION\\api\\dist\\mcp\\orion-mcp.js"] };

describe("assistant CLI engines", () => {
  it("codex: task from stdin, ORION's MCP server by TOML literals, the token only by name", () => {
    const args = codexArgs(mcp, "C:\\tmp\\answer.md", false);
    expect(args.slice(0, 5)).toEqual(["exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only"]);
    expect(args.at(-1)).toBe("-");
    expect(args).toContain("mcp_servers.orion_chat.command='C:\\Program Files\\ORION\\node.exe'");
    expect(args).toContain("mcp_servers.orion_chat.args=['C:\\Program Files\\ORION\\api\\dist\\mcp\\orion-mcp.js']");
    expect(args).toContain("mcp_servers.orion_chat.env_vars=['ORION_AGENT_TOKEN','ORION_API_URL']");
    expect(args).not.toContain("mcp_servers.orion.enabled=false");
    expect(codexArgs(mcp, "x", true)).toContain("mcp_servers.orion.enabled=false");
    expect(() => codexArgs({ command: "C:\\it's\\node.exe", args: [] }, "x", false)).toThrow();
  });

  it("cursor: a fixed instruction on the command line, the server in the folder's mcp.json", () => {
    expect(cursorArgs().slice(0, 4)).toEqual(["-p", "--approve-mcps", "--output-format", "text"]);
    expect(JSON.parse(cursorMcpJson(mcp, { ORION_AGENT_TOKEN: "t" }))).toEqual({ mcpServers: { orion_chat: { ...mcp, env: { ORION_AGENT_TOKEN: "t" } } } });
  });

  it("cmd.exe quoting refuses what could escape the quotes or expand a variable", () => {
    expect(cmdQuote("C:\\a b\\codex.cmd")).toBe('"C:\\a b\\codex.cmd"');
    for (const bad of ['a"b', "%PATH%", "a\nb"]) expect(() => cmdQuote(bad)).toThrow();
  });

  it("finds the program by override, on PATH, and `agent` only inside a Cursor folder", () => {
    const files = new Set(["C:\\bin\\codex.cmd", "C:\\tools\\agent.exe", "C:\\Users\\me\\AppData\\Local\\cursor-agent\\agent.exe"]);
    const exists = (file: string): boolean => files.has(file);
    expect(findCliBinary("codex", { PATH: "C:\\bin" }, "win32", exists)).toEqual({ file: "C:\\bin\\codex.cmd", viaCmd: true });
    expect(findCliBinary("cursor", { PATH: "C:\\tools" }, "win32", exists)).toBeNull();
    expect(findCliBinary("cursor", { PATH: "C:\\Users\\me\\AppData\\Local\\cursor-agent" }, "win32", exists)).toEqual({ file: "C:\\Users\\me\\AppData\\Local\\cursor-agent\\agent.exe", viaCmd: false });
    expect(findCliBinary("codex", { PATH: "C:\\bin", ORION_CODEX_BIN: "C:\\elsewhere\\codex.exe" }, "win32", exists)).toBeNull();
  });

  it("explains a failed run in Russian", () => {
    expect(cliFailure("codex", "Error: not authenticated, run codex login")).toContain("codex login");
    expect(cliFailure("cursor", "429 rate limit")).toContain("лимит");
    expect(cliFailure("codex", "segfault")).toContain("Codex завершился с ошибкой");
  });
});

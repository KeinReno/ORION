import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentTokensService } from "./agent-tokens.service";
import { agentTokenFilePath } from "./agent-client-install";
import { AgentClientInstallService, verifyLocalAgentBridge } from "./agent-client-install.service";

const url = "http://127.0.0.1:4000";
const token = "orion_agt_" + "a".repeat(32);

describe("one-click API handshake", () => {
  it("checks the actual Orion REST authentication and expected workspace/role", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ workspaceId: "workspace", mode: "admin" }), { status: 200 })
    );
    await verifyLocalAgentBridge(url, token, "workspace", "admin", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [address, options] = fetchImpl.mock.calls[0]!;
    expect(String(address)).toBe(url + "/ai/v1/me");
    expect(options.headers.Authorization).toBe("Bearer " + token);
    expect(options.redirect).toBe("error");
  });

  it("rejects a 401 or wrong workspace/role", async () => {
    const unauthorized = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    await expect(verifyLocalAgentBridge(url, token, "workspace", "admin", unauthorized as unknown as typeof fetch))
      .rejects.toThrow(/401/);
    const wrong = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ workspaceId: "foreign", mode: "assistant" }), { status: 200 })
    );
    await expect(verifyLocalAgentBridge(url, token, "workspace", "admin", wrong as unknown as typeof fetch))
      .rejects.toThrow(/не соответствует/);
  });

  it("refuses to send agent credentials to non-loopback destinations", async () => {
    const fetchImpl = vi.fn();
    for (const address of ["https://example.org", "http://192.168.0.1:4000", "http://evil@127.0.0.1:4000"]) {
      await expect(verifyLocalAgentBridge(address, token, "workspace", "admin", fetchImpl as unknown as typeof fetch))
        .rejects.toThrow();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});


vi.mock("./agent-connection", () => ({ resolveAgentConnection: () => ({ mode: "local", command: "node", args: ["adapter"], apiUrl: "http://127.0.0.1:4000" }) }));

describe("one-click credential transaction", () => {
  const scratch: string[] = [];
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
  function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-install-service-")); scratch.push(dir);
    const config = path.join(dir, "config.toml");
    const original = '[mcp_servers.github]\r\ncommand="gh"\r\n';
    fs.writeFileSync(config, original);
    const tokenFile = agentTokenFilePath("codex", config);
    const oldSecret = "orion_agt_" + "b".repeat(32);
    fs.writeFileSync(tokenFile, oldSecret + "\n");
    const tokens = { list: vi.fn().mockResolvedValue([{ id: "old", name: "Codex", revokedAt: null, expiresAt: null }]),
      create: vi.fn().mockResolvedValue({ id: "new", secret: token, mode: "assistant" }), revoke: vi.fn().mockResolvedValue(undefined) };
    const service = new AgentClientInstallService(tokens as unknown as AgentTokensService);
    const run = () => service.install("owner", "workspace", { client: "codex", scopes: ["tasks:read"] }, config);
    return { config, original, tokenFile, oldSecret, tokens, service, run };
  }
  const response = () => new Response(JSON.stringify({ workspaceId: "workspace", mode: "assistant" }));
  it("401 revokes only the new token and preserves existing credentials/configuration", async () => {
    const state = setup(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    await expect(state.run()).rejects.toThrow(/401/);
    expect(fs.readFileSync(state.config, "utf8")).toBe(state.original);
    expect(fs.readFileSync(state.tokenFile, "utf8").trim()).toBe(state.oldSecret);
    expect(state.tokens.revoke.mock.calls).toEqual([["owner", "workspace", "new"]]);
  });
  it("rolls back the token file if replacing the configuration fails", async () => {
    const state = setup(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { if (to === state.config) throw new Error("write failed"); return rename(from, to); });
    await expect(state.run()).rejects.toThrow();
    expect(fs.readFileSync(state.config, "utf8")).toBe(state.original);
    expect(fs.readFileSync(state.tokenFile, "utf8").trim()).toBe(state.oldSecret);
    expect(state.tokens.revoke.mock.calls).toEqual([["owner", "workspace", "new"]]);
    expect(fs.readdirSync(path.dirname(state.config)).filter(name => name.endsWith(".tmp"))).toEqual([]);
  });
  it("refuses concurrent installs before issuing another credential", async () => {
    const state = setup(); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetchImpl = vi.fn(async () => { await gate; return response(); }); vi.stubGlobal("fetch", fetchImpl);
    const pending = state.run();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    await expect(state.run()).rejects.toThrow(/уже выполняется/);
    release(); await pending;
    expect(state.tokens.create).toHaveBeenCalledOnce();
    expect(fs.readFileSync(state.tokenFile, "utf8").trim()).toBe(token);
    expect(fs.readFileSync(state.config, "utf8")).not.toContain(token);
  });
  it("preserves a configuration changed by another program during the auth handshake", async () => {
    const state = setup(); const changed = state.original + 'model="user-edit"\n';
    vi.stubGlobal("fetch", vi.fn(async () => { fs.writeFileSync(state.config, changed); return response(); }));
    await expect(state.run()).rejects.toThrow(/изменились/);
    expect(fs.readFileSync(state.config, "utf8")).toBe(changed);
    expect(fs.readFileSync(state.tokenFile, "utf8").trim()).toBe(state.oldSecret);
    expect(state.tokens.revoke.mock.calls).toEqual([["owner", "workspace", "new"]]);
  });
});

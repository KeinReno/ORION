import { describe, expect, it, vi } from "vitest";
import { verifyLocalAgentBridge } from "./agent-client-install.service";

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

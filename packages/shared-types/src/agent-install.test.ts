import { describe, expect, it } from "vitest";
import { installAgentClientInputSchema } from "./agent-gateway";

describe("one-click client policy input", () => {
  it("allows a deliberately unrestricted administrator without a forced lifetime", () => {
    const input = installAgentClientInputSchema.parse({ client: "codex", mode: "admin" });
    expect(input.mode).toBe("admin");
    expect(input.expiresInDays).toBeNull();
    expect(input.scopes).toEqual([]);
  });

  it("preserves explicit custom lifetime and constrained assistant scopes", () => {
    const input = installAgentClientInputSchema.parse({
      client: "cursor", mode: "assistant", scopes: ["notes:read"], expiresInDays: 730
    });
    expect(input.expiresInDays).toBe(730);
  });

  it("rejects assistant without rights or invalid lifetime", () => {
    expect(installAgentClientInputSchema.safeParse({ client: "codex", mode: "assistant" }).success).toBe(false);
    expect(installAgentClientInputSchema.safeParse({ client: "codex", mode: "admin", expiresInDays: 0 }).success).toBe(false);
  });
});

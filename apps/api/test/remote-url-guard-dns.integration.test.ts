import { BadRequestException } from "@nestjs/common";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S05 — DNS-rebinding half of the SSRF guard. Pure logic, no Nest app boot
 * and no real DB (same reasoning as the "JWT secret fail-fast" describe
 * block in `mode-security.integration.test.ts`): lives in the integration
 * config only because `apps/api` isn't covered by the root `pnpm test`
 * glob, not because it needs a live Postgres.
 *
 * `node:dns/promises` is mocked via `vi.mock` (module-namespace properties
 * on ESM built-ins can't be `vi.spyOn`'d directly — Node's ESM namespace
 * objects are non-configurable) — these tests must never issue a real DNS
 * query or network call. A hostname that *looks* public
 * (`evil.example.com`) but resolves to a loopback/private address is the
 * exact attack the hostname-only check (pre-S05-DNS-fix) could not catch.
 */
const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args)
}));

// `vi.mock("node:dns/promises", ...)` above must be hoisted before this
// module is imported, so the import happens in `beforeAll` (async test
// callback) rather than a top-level `await` — `tsconfig.test.json` targets
// ES2021/commonjs, which doesn't allow top-level await, and vitest already
// supports async setup hooks for exactly this case.
let assertPublicRemoteUrl: typeof import("../src/common/remote-url-guard").assertPublicRemoteUrl;
let assertResolvedHostIsPublic: typeof import("../src/common/remote-url-guard").assertResolvedHostIsPublic;

describe("S05: DNS-rebinding guard (assertResolvedHostIsPublic / assertPublicRemoteUrl)", () => {
  const originalAllowPrivate = process.env.ALLOW_PRIVATE_CALENDAR_URLS;

  beforeAll(async () => {
    ({ assertPublicRemoteUrl, assertResolvedHostIsPublic } = await import("../src/common/remote-url-guard"));
  });

  beforeEach(() => {
    delete process.env.ALLOW_PRIVATE_CALENDAR_URLS;
    lookupMock.mockReset();
  });

  afterEach(() => {
    if (originalAllowPrivate === undefined) delete process.env.ALLOW_PRIVATE_CALENDAR_URLS;
    else process.env.ALLOW_PRIVATE_CALENDAR_URLS = originalAllowPrivate;
  });

  it("rejects a public-looking hostname that resolves to loopback (127.0.0.1) — classic DNS rebinding", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(assertResolvedHostIsPublic("evil.example.com", "Адрес")).rejects.toThrow(BadRequestException);
    expect(lookupMock).toHaveBeenCalledWith("evil.example.com", { all: true, verbatim: true });
  });

  it("rejects a hostname that resolves to a private 10.0.0.0/8 address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);
    await expect(assertResolvedHostIsPublic("internal.example.com")).rejects.toThrow(BadRequestException);
  });

  it("rejects a hostname that resolves to a 192.168.0.0/16 address", async () => {
    lookupMock.mockResolvedValue([{ address: "192.168.1.50", family: 4 }]);
    await expect(assertResolvedHostIsPublic("lan.example.com")).rejects.toThrow(BadRequestException);
  });

  it("rejects a hostname that resolves to a 172.16.0.0/12 address", async () => {
    lookupMock.mockResolvedValue([{ address: "172.20.0.5", family: 4 }]);
    await expect(assertResolvedHostIsPublic("docker.example.com")).rejects.toThrow(BadRequestException);
  });

  it("rejects a hostname that resolves to link-local (169.254.169.254 — cloud metadata)", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    await expect(assertResolvedHostIsPublic("metadata.example.com")).rejects.toThrow(BadRequestException);
  });

  it("rejects a hostname that resolves to IPv6 loopback (::1)", async () => {
    lookupMock.mockResolvedValue([{ address: "::1", family: 6 }]);
    await expect(assertResolvedHostIsPublic("v6.example.com")).rejects.toThrow(BadRequestException);
  });

  it("rejects a hostname that resolves to a unique-local IPv6 address (fc00::/7)", async () => {
    lookupMock.mockResolvedValue([{ address: "fd12:3456:789a::1", family: 6 }]);
    await expect(assertResolvedHostIsPublic("v6-ula.example.com")).rejects.toThrow(BadRequestException);
  });

  it("rejects when ANY of several resolved addresses is private, even if others are public", async () => {
    lookupMock.mockResolvedValue([
      { address: "203.0.113.10", family: 4 },
      { address: "127.0.0.1", family: 4 }
    ]);
    await expect(assertResolvedHostIsPublic("mixed.example.com")).rejects.toThrow(BadRequestException);
  });

  it("accepts a hostname that resolves only to public addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
    await expect(assertResolvedHostIsPublic("public.example.com")).resolves.toBeUndefined();
  });

  it("surfaces a DNS resolution failure as a rejection, not a silent pass-through", async () => {
    lookupMock.mockRejectedValue(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
    await expect(assertResolvedHostIsPublic("nowhere.example.test")).rejects.toThrow(BadRequestException);
  });

  it("ALLOW_PRIVATE_CALENDAR_URLS=true skips DNS resolution entirely (local-network opt-out, no network call)", async () => {
    process.env.ALLOW_PRIVATE_CALENDAR_URLS = "true";
    const url = await assertPublicRemoteUrl("http://rebinding.example.com/feed.ics", "Адрес");
    expect(url.hostname).toBe("rebinding.example.com");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("assertPublicRemoteUrl end-to-end: passes the hostname check but is still rejected by the DNS check", async () => {
    // "evil.example.com" is not loopback/private *by name*, so the
    // hostname-only half of the guard (pre-existing, S05 original) would
    // have let this through — this is exactly the gap the DNS check closes.
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(assertPublicRemoteUrl("http://evil.example.com/feed.ics", "Адрес календаря")).rejects.toThrow(
      BadRequestException
    );
  });

  it("assertPublicRemoteUrl end-to-end: accepts a genuinely public hostname", async () => {
    lookupMock.mockResolvedValue([{ address: "203.0.113.55", family: 4 }]);
    const url = await assertPublicRemoteUrl("https://cal.example.com/feed.ics", "Адрес календаря");
    expect(url.hostname).toBe("cal.example.com");
  });
});

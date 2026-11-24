import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { createHostGuard, hostnameOf } from "./host-guard";

describe("hostnameOf", () => {
  it("strips the port and lowercases", () => {
    expect(hostnameOf("127.0.0.1:14000")).toBe("127.0.0.1");
    expect(hostnameOf("LOCALHOST:3010")).toBe("localhost");
    expect(hostnameOf("Orion-PC:14000")).toBe("orion-pc");
  });

  it("handles bracketed IPv6 with and without a port", () => {
    expect(hostnameOf("[::1]:14000")).toBe("::1");
    expect(hostnameOf("[2001:db8::1]:4443")).toBe("2001:db8::1");
    expect(hostnameOf("[::1]")).toBe("::1");
  });

  it("handles a bare IPv6 without brackets", () => {
    expect(hostnameOf("::1")).toBe("::1");
  });

  it("normalises the IPv4-mapped IPv6 prefix", () => {
    expect(hostnameOf("[::ffff:127.0.0.1]:14000")).toBe("127.0.0.1");
    expect(hostnameOf("::ffff:127.0.0.1")).toBe("127.0.0.1");
  });

  it("returns null for missing or malformed values", () => {
    expect(hostnameOf(undefined)).toBeNull();
    expect(hostnameOf("")).toBeNull();
    expect(hostnameOf("   ")).toBeNull();
    expect(hostnameOf("[::1")).toBeNull();
  });
});

function runGuard(
  guard: ReturnType<typeof createHostGuard>,
  headers: Record<string, string | undefined>
): { status: number; body: unknown; nexted: boolean } {
  let nexted = false;
  let status = 0;
  let body: unknown = null;
  const request = { headers } as unknown as Request;
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    }
  } as unknown as Response;
  guard(request, response, () => {
    nexted = true;
  });
  return { status, body, nexted };
}

const DESKTOP_ORIGINS = ["http://tauri.localhost", "tauri://localhost", "http://localhost:3010"];

describe("createHostGuard", () => {
  it("allows loopback hosts with the API port and calls next", () => {
    const guard = createHostGuard({ allowedOrigins: DESKTOP_ORIGINS });
    for (const host of ["127.0.0.1:14000", "localhost:14000", "[::1]:14000", "127.0.0.1"]) {
      const result = runGuard(guard, { host });
      expect(result.nexted, host).toBe(true);
      expect(result.status, host).toBe(0);
    }
  });

  it("rejects a rebinding domain with 421 before any route runs", () => {
    const guard = createHostGuard({ allowedOrigins: DESKTOP_ORIGINS });
    const result = runGuard(guard, { host: "evil.example.com:14000" });
    expect(result.nexted).toBe(false);
    expect(result.status).toBe(421);
  });

  it("rejects a rebinding domain even with a whitelisted Origin", () => {
    const guard = createHostGuard({ allowedOrigins: DESKTOP_ORIGINS });
    const result = runGuard(guard, { host: "attacker.test:14000", origin: "http://tauri.localhost" });
    expect(result.nexted).toBe(false);
    expect(result.status).toBe(421);
  });

  it("rejects a missing Host header", () => {
    const guard = createHostGuard({ allowedOrigins: DESKTOP_ORIGINS });
    expect(runGuard(guard, {}).status).toBe(421);
  });

  it("allows explicitly listed extra hosts", () => {
    const guard = createHostGuard({ allowedOrigins: DESKTOP_ORIGINS, extraHosts: ["orion.lan"] });
    expect(runGuard(guard, { host: "orion.lan:14000" }).nexted).toBe(true);
    expect(runGuard(guard, { host: "other.lan:14000" }).status).toBe(421);
  });

  it("checks Origin only when the header is present", () => {
    const guard = createHostGuard({ allowedOrigins: DESKTOP_ORIGINS });
    expect(runGuard(guard, { host: "127.0.0.1:14000" }).nexted).toBe(true);
    expect(
      runGuard(guard, { host: "127.0.0.1:14000", origin: "http://tauri.localhost" }).nexted
    ).toBe(true);
    const rejected = runGuard(guard, { host: "127.0.0.1:14000", origin: "https://evil.example.com" });
    expect(rejected.nexted).toBe(false);
    expect(rejected.status).toBe(403);
  });

  it("allows loopback origins on any port (dev servers and tests)", () => {
    const guard = createHostGuard({ allowedOrigins: DESKTOP_ORIGINS });
    expect(runGuard(guard, { host: "127.0.0.1:14000", origin: "http://127.0.0.1:53124" }).nexted).toBe(true);
    expect(runGuard(guard, { host: "127.0.0.1:14000", origin: "http://localhost:3011" }).nexted).toBe(true);
  });

  it("rejects a cross-origin mutation attempt from a whitelisted host", () => {
    const guard = createHostGuard({ allowedOrigins: DESKTOP_ORIGINS });
    // Host валиден (локальный), но Origin чужой — простой POST с чужого сайта
    // не должен доходить до обработчиков, даже если CORS «скроет» ответ.
    const result = runGuard(guard, { host: "127.0.0.1:14000", origin: "null" });
    expect(result.nexted).toBe(false);
    expect(result.status).toBe(403);
  });
});

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { resolveJwtSecret } from "../src/common/jwt-secret";
import { resolveMode } from "../src/common/orion-mode";

/**
 * S05 — local/server mode split and outbound network risk. Two kinds of
 * coverage on purpose:
 *  - Pure logic (`resolveJwtSecret`/`resolveMode`) tested directly, no Nest
 *    boot, because `JwtModule.register()` reads the secret once at
 *    AuthModule's *import* time — a running app can't demonstrate the
 *    fail-fast path against a second, different env without a second
 *    process. Testing the function directly is the honest way to cover it.
 *  - Everything else (`ORION_MODE`, the calendar/WebDAV SSRF guard) is read
 *    fresh per request, so a single already-booted app can flip
 *    `process.env.ORION_MODE` around each request and observe the change —
 *    exactly how a real deployment would set it once at process start.
 */
describe("S05: JWT secret fail-fast (pure, no app boot)", () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalMode = process.env.ORION_MODE;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalMode === undefined) delete process.env.ORION_MODE;
    else process.env.ORION_MODE = originalMode;
  });

  it("refuses to start in server mode without JWT_SECRET", () => {
    process.env.ORION_MODE = "server";
    delete process.env.JWT_SECRET;
    expect(() => resolveJwtSecret()).toThrow(/JWT_SECRET is required/);
  });

  it("falls back to the dev secret in local mode (desktop/no .env yet)", () => {
    process.env.ORION_MODE = "local";
    delete process.env.JWT_SECRET;
    expect(resolveJwtSecret()).toBe("dev-only-insecure-secret");
  });

  it("uses the configured secret in server mode when it is set", () => {
    process.env.ORION_MODE = "server";
    process.env.JWT_SECRET = "a-real-secret";
    expect(resolveJwtSecret()).toBe("a-real-secret");
  });

  it("rejects a garbage ORION_MODE instead of silently guessing", () => {
    process.env.ORION_MODE = "production"; // not a valid value
    expect(() => resolveMode()).toThrow(/must be "local" or "server"/);
  });
});

describe("S05: local/server mode over HTTP", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `s05-${runId}`;
  const originalMode = process.env.ORION_MODE;
  const originalAllowPrivate = process.env.ALLOW_PRIVATE_CALENDAR_URLS;
  const originalTrustedProxies = process.env.ORION_TRUSTED_PROXIES;

  beforeAll(async () => {
    // App boots once under whatever ORION_MODE is set at import time
    // (default: unset -> "local", matching setup-integration.ts). The tests
    // below flip process.env.ORION_MODE per request — every check that
    // matters here (account picker gate, PIN/password policy) reads it at
    // request time, not at boot time, so this is a faithful reproduction of
    // an operator setting ORION_MODE once before starting the real process.
    // Most existing requests use synthetic client IPs to keep limiter buckets
    // independent. They reach the test server through loopback, an explicitly
    // trusted proxy only in this test app.
    process.env.ORION_TRUSTED_PROXIES = "127.0.0.1/8,::1/128";
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (originalMode === undefined) delete process.env.ORION_MODE;
    else process.env.ORION_MODE = originalMode;
    if (originalAllowPrivate === undefined) delete process.env.ALLOW_PRIVATE_CALENDAR_URLS;
    else process.env.ALLOW_PRIVATE_CALENDAR_URLS = originalAllowPrivate;
    if (originalTrustedProxies === undefined) delete process.env.ORION_TRUSTED_PROXIES;
    else process.env.ORION_TRUSTED_PROXIES = originalTrustedProxies;

    if (prisma) {
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true } });
        if (users.length === 0) return;
        const userIds = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      });
    }
    await app?.close();
  });

  it("GET /system/mode is public (no Authorization) and reports local mode", async () => {
    process.env.ORION_MODE = "local";
    const res = await fetch(`${baseUrl}/system/mode`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "local" });
  });

  it("GET /system/mode reports server mode without requiring auth either", async () => {
    process.env.ORION_MODE = "server";
    const res = await fetch(`${baseUrl}/system/mode`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "server" });
  });

  it("local mode serves the account picker directory", async () => {
    process.env.ORION_MODE = "local";
    const res = await request("/auth/accounts", { method: "GET" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
  });

  it("server mode refuses the account picker directory (no PIN/no directory done-criterion)", async () => {
    process.env.ORION_MODE = "server";
    const res = await request("/auth/accounts", { method: "GET" });
    expect(res.status).toBe(403);
  });

  it("server mode rejects PIN registration", async () => {
    process.env.ORION_MODE = "server";
    const res = await request("/auth/register", {
      method: "POST",
      ip: "203.0.113.10",
      body: { name: "pin-user", email: `${emailPrefix}-pin@example.test`, pin: "1234" }
    });
    expect(res.status).toBe(400);
  });

  it("server mode rejects a weak password on registration", async () => {
    process.env.ORION_MODE = "server";
    const res = await request("/auth/register", {
      method: "POST",
      ip: "203.0.113.11",
      body: { name: "weak-user", email: `${emailPrefix}-weak@example.test`, password: "abcdefgh" }
    });
    expect(res.status).toBe(400);
  });

  it("server mode accepts a strong password on registration; local mode still accepts PIN", async () => {
    process.env.ORION_MODE = "server";
    const strong = await request("/auth/register", {
      method: "POST",
      ip: "203.0.113.12",
      body: { name: "strong-user", email: `${emailPrefix}-strong@example.test`, password: "Correct-Horse-42!" }
    });
    expect(strong.status).toBe(201);

    process.env.ORION_MODE = "local";
    const pinOk = await request("/auth/register", {
      method: "POST",
      ip: "203.0.113.13",
      body: { name: "pin-user-local", email: `${emailPrefix}-pin-local@example.test`, pin: "4321" }
    });
    expect(pinOk.status).toBe(201);
  });

  it("server mode rejects PIN login even for an existing account", async () => {
    process.env.ORION_MODE = "local";
    const created = await request<{ user: { id: string } }>("/auth/register", {
      method: "POST",
      ip: "203.0.113.14",
      body: { name: "login-pin-user", email: `${emailPrefix}-login-pin@example.test`, pin: "9876" }
    });
    expect(created.status).toBe(201);

    process.env.ORION_MODE = "server";
    const res = await request("/auth/login", {
      method: "POST",
      ip: "203.0.113.14",
      body: { email: `${emailPrefix}-login-pin@example.test`, pin: "9876" }
    });
    expect(res.status).toBe(400);
  });

  it("login is rate-limited: the 11th attempt in the window is rejected", async () => {
    process.env.ORION_MODE = "local";
    // Its own synthetic IP, isolated from every other test's bucket — this
    // test *intends* to trip the limiter and must not poison later tests'
    // register calls, and must not inherit hits from earlier ones either.
    const ip = "203.0.113.99";
    let last = { status: 0 };
    for (let i = 0; i < 11; i += 1) {
      last = await request("/auth/login", {
        method: "POST",
        ip,
        body: { email: "nobody@example.test", password: "wrong-password" }
      });
    }
    expect(last.status).toBe(429);
  });

  it("untrusted X-Forwarded-For cannot rotate the login limiter bucket", async () => {
    process.env.ORION_MODE = "local";
    const expressApp = app.getHttpAdapter().getInstance() as { set(name: string, value: unknown): void };
    expressApp.set("trust proxy", false);
    try {
      let last = { status: 0 };
      for (let i = 0; i < 11; i += 1) {
        last = await request("/auth/login", {
          method: "POST",
          ip: `203.0.113.${100 + i}`,
          body: { email: "nobody@example.test", password: "wrong-password" }
        });
      }
      expect(last.status).toBe(429);
    } finally {
      expressApp.set("trust proxy", ["127.0.0.1/8", "::1/128"]);
    }
  });

  it("behind a trusted proxy that appends X-Forwarded-For, a spoofed prefix cannot rotate the login bucket", async () => {
    // nginx's default `proxy_add_x_forwarded_for` keeps whatever the client sent
    // and appends the address it saw: "<client-controlled…>, <real client>".
    // With only the proxy trusted, Express must key on the rightmost untrusted
    // entry (the real client), so rotating the left part changes nothing.
    process.env.ORION_MODE = "local";
    let last = { status: 0 };
    for (let i = 0; i < 11; i += 1) {
      last = await request("/auth/login", {
        method: "POST",
        ip: `203.0.113.${150 + i}, 198.51.100.77`,
        body: { email: "nobody@example.test", password: "wrong-password" }
      });
    }
    expect(last.status).toBe(429);
  });

  it("register tolerates a legitimate bulk scenario: many distinct emails from one IP all succeed", async () => {
    process.env.ORION_MODE = "local";
    // Reproduces the exact pattern that broke when the first attempt at a
    // register limiter used a flat per-IP counter: this repo's own
    // integration tests (api-rls.integration.test.ts) register dozens of
    // accounts from one loopback IP in a single run. 20 is comfortably more
    // than the login guard's 10/5min cap would allow, and still well under
    // RegisterRateLimitGuard's generous per-IP window (60/5min) — every one
    // of these must succeed.
    const ip = "203.0.113.30";
    for (let i = 0; i < 20; i += 1) {
      const res = await request("/auth/register", {
        method: "POST",
        ip,
        body: { name: `bulk-${i}`, email: `${emailPrefix}-bulk-${i}@example.test`, password: "Correct-Horse-42!" }
      });
      expect(res.status).toBe(201);
    }
  });

  it("register blocks the actual abuse pattern: repeated attempts against the same email from one IP", async () => {
    process.env.ORION_MODE = "local";
    const ip = "203.0.113.31";
    const email = `${emailPrefix}-repeat@example.test`;
    let last = { status: 0 };
    // First attempt legitimately succeeds; the next 4 are the account
    // already existing (409/400 from AuthService, not the guard) — the
    // per-(IP,email) cap is 5, so the 6th call in this window must be the
    // guard's 429, not the service's own duplicate-email error.
    for (let i = 0; i < 6; i += 1) {
      last = await request("/auth/register", {
        method: "POST",
        ip,
        body: { name: "repeat-user", email, password: "Correct-Horse-42!" }
      });
    }
    expect(last.status).toBe(429);
  });

  it("untrusted X-Forwarded-For cannot rotate the registration limiter bucket", async () => {
    process.env.ORION_MODE = "local";
    const expressApp = app.getHttpAdapter().getInstance() as { set(name: string, value: unknown): void };
    expressApp.set("trust proxy", false);
    try {
      let last = { status: 0 };
      for (let i = 0; i < 6; i += 1) {
        last = await request("/auth/register", {
          method: "POST",
          ip: `203.0.113.${150 + i}`,
          body: { name: "spoof-register", email: `${emailPrefix}-spoof-register@example.test`, password: "Correct-Horse-42!" }
        });
      }
      expect(last.status).toBe(429);
    } finally {
      expressApp.set("trust proxy", ["127.0.0.1/8", "::1/128"]);
    }
  });

  it("rejects a loopback calendar URL without ever calling fetch for it (SSRF guard runs before any network I/O)", async () => {
    // The spy also observes this test's own HTTP client calls to the app
    // under test (both use Node's global fetch), so the assertion below
    // checks that the malicious URL specifically was never the target of a
    // fetch call, not that fetch was never called at all.
    process.env.ORION_MODE = "local";
    const maliciousUrl = "http://127.0.0.1:1/steal";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const owner = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
        method: "POST",
        ip: "203.0.113.20",
        body: { name: "ssrf-owner", email: `${emailPrefix}-ssrf@example.test`, password: "Correct-Horse-42!" }
      });
      expect(owner.status).toBe(201);
      const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: owner.data.accessToken });
      const workspaceId = workspaces.data[0].id;

      const created = await request("/workspaces/" + workspaceId + "/calendar-connections", {
        method: "POST",
        token: owner.data.accessToken,
        body: { name: "evil", kind: "ics", url: maliciousUrl, username: "", enabled: true }
      });
      expect(created.status).toBe(400);
      const calledUrls = fetchSpy.mock.calls.map((call) => String(call[0]));
      expect(calledUrls).not.toContain(maliciousUrl);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not follow a redirect from an allowed calendar feed to an internal address", async () => {
    // Needs a real (loopback) HTTP server, so this specific test opts into
    // ALLOW_PRIVATE_CALENDAR_URLS=true — that flag is exactly the local-
    // network escape hatch documented in .env.example, and is the only way
    // to exercise the redirect-rejection path without a public stub host.
    process.env.ORION_MODE = "local";
    process.env.ALLOW_PRIVATE_CALENDAR_URLS = "true";

    let redirectTargetHit = false;
    const server: Server = createServer((req, res) => {
      if (req.url === "/redirect-target") {
        redirectTargetHit = true;
        res.writeHead(200, { "Content-Type": "text/calendar" }).end("BEGIN:VCALENDAR\nEND:VCALENDAR");
        return;
      }
      res.writeHead(302, { Location: "/redirect-target" }).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const owner = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
        method: "POST",
        ip: "203.0.113.21",
        body: { name: "redirect-owner", email: `${emailPrefix}-redirect@example.test`, password: "Correct-Horse-42!" }
      });
      const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: owner.data.accessToken });
      const workspaceId = workspaces.data[0].id;

      const created = await request<{ id: string }>(`/workspaces/${workspaceId}/calendar-connections`, {
        method: "POST",
        token: owner.data.accessToken,
        body: { name: "redirecting", kind: "ics", url: `http://127.0.0.1:${port}/`, username: "", enabled: true }
      });
      expect(created.status).toBe(201);

      const synced = await request(`/workspaces/${workspaceId}/calendar-connections/${created.data.id}/sync`, {
        method: "POST",
        token: owner.data.accessToken
      });
      expect(synced.status).toBe(400);
      expect(redirectTargetHit).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function request<T = unknown>(
    path: string,
    options: { method: string; token?: string; body?: unknown; ip?: string }
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        // This test app explicitly trusts loopback as its proxy. Every test
        // below gets its own synthetic client IP so tests that
        // deliberately trip the limiter (see "login/register are rate-
        // limited") don't poison the shared loopback bucket for the tests
        // that run after them and need a *working* register call.
        "x-forwarded-for": options.ip ?? "203.0.113.1"
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }
});

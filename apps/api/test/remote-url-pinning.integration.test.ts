import { createServer, get as httpGet, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Connect-time DNS pinning (remote-url-guard `publicOnlyLookup` /
 * `fetchPublicText` / `publicOnlyAgents`). The S05 pre-check resolved the
 * hostname once and the request then resolved it again, so a rebinding DNS
 * server could answer "public" to the check and "127.0.0.1" to the socket.
 * Here the resolver does exactly that, and a real loopback HTTP server
 * counts hits: the request must fail WITHOUT reaching it.
 *
 * `node:dns` (callback API — what `net.connect`'s `lookup` hook uses) is
 * mocked; no real DNS query leaves the process. Lives in the integration
 * config only because `apps/api` isn't in the root unit glob.
 */
const lookupMock = vi.fn();
vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns")>();
  return { ...actual, lookup: (...args: unknown[]) => lookupMock(...args) };
});

let guard: typeof import("../src/common/remote-url-guard");

describe("remote URL guard: DNS pinned at connect time", () => {
  let server: Server;
  let port: number;
  let hits = 0;
  const originalAllowPrivate = process.env.ALLOW_PRIVATE_CALENDAR_URLS;

  beforeAll(async () => {
    guard = await import("../src/common/remote-url-guard");
    server = createServer((_req, res) => {
      hits += 1;
      res.writeHead(200, { "Content-Type": "text/calendar" });
      res.end("BEGIN:VCALENDAR\nEND:VCALENDAR\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    hits = 0;
    delete process.env.ALLOW_PRIVATE_CALENDAR_URLS;
    lookupMock.mockReset();
  });

  afterEach(() => {
    if (originalAllowPrivate === undefined) delete process.env.ALLOW_PRIVATE_CALENDAR_URLS;
    else process.env.ALLOW_PRIVATE_CALENDAR_URLS = originalAllowPrivate;
  });

  /** Resolver that answers the socket's lookup with `address`. */
  function resolveTo(address: string, family = 4): void {
    lookupMock.mockImplementation((_host: string, _opts: unknown, cb: (e: null, a: unknown) => void) =>
      cb(null, [{ address, family }])
    );
  }

  it("refuses to connect when the connect-time answer is loopback (rebinding after the pre-check)", async () => {
    resolveTo("127.0.0.1");
    await expect(guard.fetchPublicText(`http://calendar.example.test:${port}/feed.ics`)).rejects.toThrow(/DNS rebinding/);
    expect(hits).toBe(0);
  });

  it("refuses IPv4-mapped IPv6 loopback too", async () => {
    resolveTo("::ffff:127.0.0.1", 6);
    await expect(guard.fetchPublicText(`http://calendar.example.test:${port}/feed.ics`)).rejects.toThrow(/DNS rebinding/);
    expect(hits).toBe(0);
  });

  it("connects when private addresses are explicitly allowed", async () => {
    process.env.ALLOW_PRIVATE_CALENDAR_URLS = "true";
    resolveTo("127.0.0.1");
    await expect(guard.fetchPublicText(`http://calendar.example.test:${port}/feed.ics`)).resolves.toContain("VCALENDAR");
    expect(hits).toBe(1);
  });

  it("does not follow redirects and caps the body while streaming", async () => {
    process.env.ALLOW_PRIVATE_CALENDAR_URLS = "true";
    resolveTo("127.0.0.1");
    const redirecting = createServer((_req, res) => {
      res.writeHead(302, { Location: "http://169.254.169.254/" });
      res.end();
    });
    await new Promise<void>((resolve) => redirecting.listen(0, "127.0.0.1", resolve));
    const redirectPort = (redirecting.address() as AddressInfo).port;
    await expect(guard.fetchPublicText(`http://feed.example.test:${redirectPort}/`)).rejects.toThrow(/редирект/);
    await new Promise<void>((resolve) => redirecting.close(() => resolve()));

    await expect(guard.fetchPublicText(`http://feed.example.test:${port}/`, { maxBytes: 10 })).rejects.toThrow(/размер/);
  });

  it("pins the WebDAV agents as well", async () => {
    resolveTo("10.0.0.7");
    const { httpAgent } = guard.publicOnlyAgents();
    const outcome = await new Promise<string>((resolve) => {
      const req = httpGet(
        { host: "dav.example.test", port, path: "/", agent: httpAgent },
        () => resolve("connected")
      );
      req.on("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
    });
    httpAgent.destroy();
    expect(outcome).toBe("EPRIVATEADDR");
    expect(hits).toBe(0);
  });
});

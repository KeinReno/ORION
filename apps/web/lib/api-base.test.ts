import { describe, expect, it } from "vitest";
import { resolveApiBaseUrl } from "./api-base";

const remote = { protocol: "https:", hostname: "orion.example.com" };

describe("resolveApiBaseUrl", () => {
  it("prefers the configured URL and trims trailing slashes", () => {
    expect(resolveApiBaseUrl({ envUrl: "https://api.example.com//", location: remote, production: true })).toBe("https://api.example.com");
  });

  it("falls back to localhost in development on any host", () => {
    expect(resolveApiBaseUrl({ envUrl: undefined, location: remote, production: false })).toBe("http://localhost:4000");
  });

  it("falls back to localhost during SSR/prerender so the build passes", () => {
    expect(resolveApiBaseUrl({ envUrl: undefined, location: null, production: true })).toBe("http://localhost:4000");
  });

  it("keeps the fallback when the page itself is served from this machine", () => {
    for (const hostname of ["localhost", "127.0.0.1", "tauri.localhost"]) {
      expect(resolveApiBaseUrl({ envUrl: undefined, location: { protocol: "http:", hostname }, production: true })).toBe("http://localhost:4000");
    }
  });

  it("refuses to guess in a production browser on a remote host", () => {
    expect(() => resolveApiBaseUrl({ envUrl: undefined, location: remote, production: true })).toThrow(/NEXT_PUBLIC_API_URL/);
    expect(() => resolveApiBaseUrl({ envUrl: "  ", location: remote, production: true })).toThrow(/NEXT_PUBLIC_API_URL/);
  });

  it("rejects a loopback URL baked into a build served from another computer", () => {
    for (const envUrl of ["http://localhost:4000", "http://127.0.0.1:4000", "http://127.0.0.2:4000", "http://0.0.0.0:4000", "http://[::1]:4000"]) {
      expect(() => resolveApiBaseUrl({ envUrl, location: remote, production: true })).toThrow(/localhost/);
    }
    expect(resolveApiBaseUrl({ envUrl: "http://localhost:4000", location: { protocol: "http:", hostname: "localhost" }, production: true })).toBe("http://localhost:4000");
  });
});

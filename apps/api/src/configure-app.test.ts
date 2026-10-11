import { describe, expect, it } from "vitest";
import { parseTrustedProxies } from "./configure-app";

describe("trusted proxy configuration", () => {
  it("defaults to direct client IP and accepts only explicit IPs or CIDRs", () => {
    expect(parseTrustedProxies(undefined)).toEqual([]);
    expect(parseTrustedProxies("127.0.0.1/8, ::1/128")).toEqual(["127.0.0.1/8", "::1/128"]);
  });

  it.each(["true", "*", "loopback", "0", "0.0.0.0/0", "::/0", "127.0.0.1/33", "::1/129", "127.0.0.1/"]) (
    "rejects broad or malformed proxy trust: %s",
    (value) => expect(() => parseTrustedProxies(value)).toThrow(/ORION_TRUSTED_PROXIES/)
  );
});

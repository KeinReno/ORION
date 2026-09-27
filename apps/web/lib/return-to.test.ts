import { describe, expect, it } from "vitest";
import { sanitizeReturnTo } from "./return-to";

describe("sanitizeReturnTo", () => {
  it("accepts a plain internal path", () => {
    expect(sanitizeReturnTo("/invite?token=abc123")).toBe("/invite?token=abc123");
    expect(sanitizeReturnTo("/spaces")).toBe("/spaces");
  });

  it("rejects null/undefined/empty", () => {
    expect(sanitizeReturnTo(null)).toBeNull();
    expect(sanitizeReturnTo(undefined)).toBeNull();
    expect(sanitizeReturnTo("")).toBeNull();
  });

  it("rejects an absolute external URL (open redirect)", () => {
    expect(sanitizeReturnTo("https://evil.example/phish")).toBeNull();
    expect(sanitizeReturnTo("http://evil.example")).toBeNull();
  });

  it("rejects protocol-relative //host (looks like a path, resolves off-origin)", () => {
    expect(sanitizeReturnTo("//evil.example")).toBeNull();
    expect(sanitizeReturnTo("///evil.example")).toBeNull();
  });

  it("rejects backslash tricks some browsers normalize to //", () => {
    expect(sanitizeReturnTo("/\\evil.example")).toBeNull();
  });

  it("rejects a path with no leading slash", () => {
    expect(sanitizeReturnTo("invite?token=abc")).toBeNull();
    expect(sanitizeReturnTo("javascript:alert(1)")).toBeNull();
  });

  it("rejects whitespace/control characters", () => {
    expect(sanitizeReturnTo("/invite\n?token=abc")).toBeNull();
    expect(sanitizeReturnTo("/invite token=abc")).toBeNull();
  });

  it("rejects an implausibly long value", () => {
    expect(sanitizeReturnTo("/" + "a".repeat(3000))).toBeNull();
  });
});

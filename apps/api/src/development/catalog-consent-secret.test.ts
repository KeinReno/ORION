import { describe, expect, it } from "vitest";
import { hashDevelopmentConsentSecret, issueDevelopmentConsentSecret } from "./catalog-consent-secret";

describe("development import consent bearer secret", () => {
  it("generates distinct 256-bit secrets and hashes, never persisting plaintext", () => {
    const first = issueDevelopmentConsentSecret();
    const second = issueDevelopmentConsentSecret();
    expect(first.token).toMatch(/^[a-f0-9]{64}$/);
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.tokenHash).toBe(hashDevelopmentConsentSecret(first.token));
    expect(first.tokenHash).not.toBe(first.token);
    expect(second.token).not.toBe(first.token);
    expect(second.tokenHash).not.toBe(first.tokenHash);
  });

  it("rejects malformed tokens before hashing", () => {
    for (const token of ["", "abc", "A".repeat(64), "g".repeat(64), "a".repeat(65)]) {
      expect(() => hashDevelopmentConsentSecret(token)).toThrow(/Invalid development consent token/);
    }
    expect(() => hashDevelopmentConsentSecret(null as unknown as string)).toThrow();
  });
});

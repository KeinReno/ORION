import { createHash, randomBytes } from "node:crypto";
import { ConflictException } from "@nestjs/common";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Generate a bearer secret for a future server-held, single-use import consent.
 * Persist only tokenHash, never the raw token. Issuance and consumption must
 * enforce actor, workspace, expiry and atomic replay prevention separately.
 */
export function issueDevelopmentConsentSecret(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  return { token, tokenHash: hashDevelopmentConsentSecret(token) };
}

export function hashDevelopmentConsentSecret(token: string): string {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    throw new ConflictException("Invalid development consent token");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

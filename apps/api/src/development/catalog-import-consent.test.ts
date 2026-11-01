import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  consumeImportConsentTx, hashImportConsentToken, issueImportConsentTx
} from "./catalog-import-consent";

const scope = {
  userId: "user", workspaceId: "workspace", catalogId: "orion-dev",
  catalogSha256: "a".repeat(64), previewDigest: "b".repeat(64),
  selectionHash: "c".repeat(64)
};

describe("development import consent", () => {
  it("issues a random short-lived token but persists only its hash", async () => {
    const create = vi.fn().mockResolvedValue({});
    const tx = { developmentImportConsent: { create } } as unknown as Prisma.TransactionClient;
    const now = new Date("2026-11-01T10:00:00.000Z");
    const result = await issueImportConsentTx(tx, scope, now);
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(result.expiresAt.toISOString()).toBe("2026-11-01T10:05:00.000Z");
    expect(create).toHaveBeenCalledWith({
      data: { ...scope, tokenHash: hashImportConsentToken(result.token), expiresAt: result.expiresAt }
    });
    expect(JSON.stringify(create.mock.calls)).not.toContain(result.token);
  });
  it("atomically filters by scope, token, expiry and unused state", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { developmentImportConsent: { updateMany } } as unknown as Prisma.TransactionClient;
    const now = new Date("2026-11-01T10:00:00.000Z");
    await consumeImportConsentTx(tx, scope, "a".repeat(64), now);
    expect(updateMany).toHaveBeenCalledWith({
      where: { ...scope, tokenHash: hashImportConsentToken("a".repeat(64)),
        consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now }
    });
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(consumeImportConsentTx(tx, scope, "a".repeat(64), now))
      .rejects.toThrow(/expired, used or mismatched/);
  });
  it("rejects malformed tokens and scope", async () => {
    expect(() => hashImportConsentToken("invalid")).toThrow();
    const tx = { developmentImportConsent: { create: vi.fn() } } as unknown as Prisma.TransactionClient;
    await expect(issueImportConsentTx(tx, { ...scope, workspaceId: "" })).rejects.toThrow();
  });
});

import { issueDevelopmentConsentSecret, hashDevelopmentConsentSecret } from "./catalog-consent-secret";
import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export interface ImportConsentScope {
  userId: string;
  workspaceId: string;
  catalogId: string;
  catalogSha256: string;
  previewDigest: string;
  selectionHash: string;
}

function assertConsentScope(scope: ImportConsentScope, now: Date): void {
  if (!scope || typeof scope.userId !== "string" || !scope.userId.trim() ||
      typeof scope.workspaceId !== "string" || !scope.workspaceId.trim() ||
      scope.catalogId !== "orion-dev" ||
      ![scope.catalogSha256, scope.previewDigest, scope.selectionHash]
        .every((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) ||
      !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new ConflictException("Invalid consent scope");
  }
}

export function hashImportConsentToken(token: string): string {
  return hashDevelopmentConsentSecret(token);
}

/** Must run in PrismaService.withUser(userId, ...) after preview validation. */
export async function issueImportConsentTx(
  tx: Prisma.TransactionClient,
  scope: ImportConsentScope,
  now = new Date()
) {
  assertConsentScope(scope, now);
  const { token, tokenHash } = issueDevelopmentConsentSecret();
  const expiresAt = new Date(now.getTime() + 5 * 60_000);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new ConflictException("Invalid consent expiry");
  }
  await tx.developmentImportConsent.create({
    data: { ...scope, tokenHash, expiresAt }
  });
  return { token, expiresAt };
}

/** Atomically marks a matching unexpired token as spent; caller's transaction
 * must roll back on any later stale-preview or import failure.
 */
export async function consumeImportConsentTx(
  tx: Prisma.TransactionClient,
  scope: ImportConsentScope,
  token: string,
  now = new Date()
): Promise<void> {
  assertConsentScope(scope, now);
  const result = await tx.developmentImportConsent.updateMany({
    where: {
      ...scope, tokenHash: hashImportConsentToken(token),
      consumedAt: null, expiresAt: { gt: now }
    },
    data: { consumedAt: now }
  });
  if (result.count !== 1) throw new ConflictException("Consent expired, used or mismatched");
}

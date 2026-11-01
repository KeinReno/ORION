import { ConflictException } from "@nestjs/common";
import { fingerprintDevelopmentPreview } from "./catalog-preview-binding";
import { requireReviewedPreviewMatches, type DevelopmentPreview } from "./catalog-preview-matches";
import type { ImportConsentScope } from "./catalog-import-consent";

export interface ReviewedConsentInput {
  userId: string;
  workspaceId: string;
  catalogSha256: string;
  previewDigest: string;
  preview: DevelopmentPreview;
  choices: Record<string, string>;
}

/** Build a consent scope only after all candidate matches are explicitly reviewed.
 * The caller must obtain userId from authentication and preview from a trusted
 * fresh server-side snapshot, never from the client request body.
 */
export function buildReviewedConsentScope(input: ReviewedConsentInput): ImportConsentScope {
  if (!input || typeof input.userId !== "string" || !input.userId.trim() ||
      typeof input.workspaceId !== "string" || !input.workspaceId.trim() ||
      input.preview?.workspaceId !== input.workspaceId ||
      input.preview.catalogId !== "orion-dev" ||
      !/^[a-f0-9]{64}$/.test(input.catalogSha256) ||
      !/^[a-f0-9]{64}$/.test(input.previewDigest) ||
      !input.choices || typeof input.choices !== "object" || Array.isArray(input.choices)) {
    throw new ConflictException("Invalid reviewed consent input");
  }
  requireReviewedPreviewMatches(input.preview, input.choices);
  return {
    userId: input.userId,
    workspaceId: input.workspaceId,
    catalogId: input.preview.catalogId,
    catalogSha256: input.catalogSha256,
    previewDigest: input.previewDigest,
    selectionHash: fingerprintDevelopmentPreview({
      userId: input.userId,
      workspaceId: input.workspaceId,
      catalogDigest: input.catalogSha256,
      preview: input.preview,
      choices: input.choices
    })
  };
}

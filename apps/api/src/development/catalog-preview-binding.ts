import { createHash } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import type { DevelopmentPreview } from "./catalog-preview-matches";

export interface PreviewBinding {
  userId: string;
  workspaceId: string;
  catalogDigest: string;
  preview: DevelopmentPreview;
  choices: Readonly<Record<string, string>>;
}

/**
 * Stable fingerprint for a preview and the user's reviewed selections.
 * This is NOT a signed confirmation token. A caller must authenticate the
 * user, supply a trusted catalog digest and compare this fingerprint against
 * a previously issued server-side record before allowing writes.
 */
export function fingerprintDevelopmentPreview(input: PreviewBinding): string {
  if (!input || !input.userId || !input.workspaceId || !input.catalogDigest ||
      !input.preview || input.preview.workspaceId !== input.workspaceId ||
      !input.preview.catalogId || !Array.isArray(input.preview.actions) ||
      !input.choices || typeof input.choices !== "object" || Array.isArray(input.choices)) {
    throw new ConflictException("Invalid development preview binding");
  }
  const keys = Object.keys(input.choices).sort();
  if (keys.some((key) => typeof input.choices[key] !== "string")) {
    throw new ConflictException("Invalid development preview choices");
  }
  const identities = input.preview.actions.map((action) => action.kind + ":" + action.externalId);
  if (new Set(identities).size !== identities.length) {
    throw new ConflictException("Duplicate development preview action");
  }
  const actions = input.preview.actions.map((action) => ({
    kind: action.kind,
    externalId: action.externalId,
    title: action.title,
    action: action.action,
    candidateId: action.candidateId,
    ...("projectExternalId" in action ? { projectExternalId: action.projectExternalId } : {}),
    ...("dependsOn" in action ? { dependsOn: [...(action.dependsOn ?? [])].sort() } : {})
  })).sort((a, b) => (a.kind + ":" + a.externalId).localeCompare(b.kind + ":" + b.externalId));
  const payload = JSON.stringify({
    userId: input.userId, workspaceId: input.workspaceId,
    catalogId: input.preview.catalogId, catalogDigest: input.catalogDigest,
    actions, choices: keys.map((key) => [key, input.choices[key]])
  });
  return createHash("sha256").update(payload).digest("hex");
}

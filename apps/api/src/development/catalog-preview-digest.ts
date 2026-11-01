import { createHash } from "node:crypto";
import { ConflictException } from "@nestjs/common";

export interface DevelopmentPreviewScope {
  userId: string;
  workspaceId: string;
  catalogId: string;
  catalogSha256: string;
}

export function digestDevelopmentPreview(
  scope: DevelopmentPreviewScope,
  snapshot: unknown
): string {
  if (!scope || !scope.userId || !scope.workspaceId || !scope.catalogId ||
      !/^[a-f0-9]{64}$/.test(scope.catalogSha256)) {
    throw new ConflictException("Invalid development preview scope");
  }
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new ConflictException("Invalid development preview snapshot");
  }
  const json = JSON.stringify({ scope, snapshot });
  return createHash("sha256").update(json).digest("hex");
}

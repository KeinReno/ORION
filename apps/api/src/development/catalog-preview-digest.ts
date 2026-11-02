import { createHash } from "node:crypto";
import { ConflictException } from "@nestjs/common";

export interface DevelopmentPreviewScope {
  userId: string;
  workspaceId: string;
  catalogId: string;
  catalogSha256: string;
}

/** Stable serialization of a JSON-compatible preview, independent of object key order. */
function canonicalPreview(value: unknown, active: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") {
    throw new ConflictException("Unsupported development preview value");
  }
  if (active.has(value)) throw new ConflictException("Cyclic development preview");
  active.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalPreview(item, active));
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) {
        throw new ConflictException("Undefined development preview field");
      }
      normalized[key] = canonicalPreview(record[key], active);
    }
    return normalized;
  } finally {
    active.delete(value);
  }
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
  const json = JSON.stringify(canonicalPreview({ scope, snapshot }, new WeakSet<object>()));
  return createHash("sha256").update(json).digest("hex");
}

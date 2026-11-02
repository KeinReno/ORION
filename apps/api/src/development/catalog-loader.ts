import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConflictException } from "@nestjs/common";
import type { TrustedDevelopmentCatalog } from "./catalog-trust";

export interface LoadedDevelopmentCatalog {
  catalog: TrustedDevelopmentCatalog;
  sha256: string;
}

/** Bundled catalog is inside the immutable API package, including updater payloads. */
export function configuredDevelopmentCatalogRoot(): string {
  if (process.env.ORION_DEV_CATALOG_ROOT) return process.env.ORION_DEV_CATALOG_ROOT;
  const bundledRoot = resolve(__dirname, "../..");
  if (existsSync(resolve(bundledRoot, "development", "orion-dev.catalog.json"))) return bundledRoot;
  throw new ConflictException("ORION_DEV_CATALOG_ROOT is not configured");
}

/**
 * Read the versioned catalog from a fixed repository-relative location.
 * repoRoot must be controlled by server configuration, never an HTTP field.
 * The digest is suitable for binding a future confirmation to this version.
 */
export function loadDevelopmentCatalog(repoRoot: string): LoadedDevelopmentCatalog {
  if (!repoRoot || typeof repoRoot !== "string") {
    throw new ConflictException("Development catalog root not configured");
  }
  let raw: string;
  try {
    raw = readFileSync(resolve(repoRoot, "development", "orion-dev.catalog.json"), "utf8");
  } catch {
    throw new ConflictException("Development catalog unavailable");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ConflictException("Development catalog is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConflictException("Invalid development catalog");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || record.catalogId !== "orion-dev" ||
      !Array.isArray(record.projects) || !Array.isArray(record.workItems) ||
      !Array.isArray(record.phases)) {
    throw new ConflictException("Unsupported development catalog version or structure");
  }
  const ids = new Set<string>();
  for (const phase of record.phases) {
    if (!phase || typeof phase !== "object" || typeof phase.id !== "string" ||
        !phase.id || ids.has(phase.id)) {
      throw new ConflictException("Invalid development catalog phase");
    }
    ids.add(phase.id);
  }
  // The trusted import validator performs detailed project/task/dependency
  // checks before any write. This loader only checks the fixed file contract.
  return {
    catalog: record as unknown as TrustedDevelopmentCatalog,
    sha256: createHash("sha256").update(raw, "utf8").digest("hex")
  };
}

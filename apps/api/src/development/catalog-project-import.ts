import { lockDevelopmentImportTx } from "./catalog-write-lock";
import { developmentProjectCatalog } from "../projects/public/development-catalog";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { bindCatalogEntityTx } from "./catalog-mappings";

export interface ConfirmedCatalogProject {
  externalId: string;
  title: string;
  /** Required for an existing name match. Never infer identity from title. */
  confirmedExistingId?: string;
}

export interface ProjectImportResult {
  externalId: string;
  entityId: string;
  outcome: "created" | "already_mapped" | "confirmed_existing";
}

/**
 * Atomic project-only import stage. The caller must authenticate, explicitly
 * confirm the selected workspace and provide a validated catalog. Do not
 * expose this as an endpoint without a separate confirmation/dry-run gate.
 *
 * Execute inside PrismaService.withUser. All writes, including mappings, roll
 * back together. No project fields are overwritten on retry.
 */
export async function importConfirmedCatalogProjectsTx(
  tx: Prisma.TransactionClient,
  userId: string,
  workspaceId: string,
  catalogId: string,
  projects: readonly ConfirmedCatalogProject[]
): Promise<ProjectImportResult[]> {
  if (!workspaceId || !catalogId || !Array.isArray(projects)) {
    throw new ConflictException("Invalid catalog import request");
  }
  const membership = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } }
  });
  if (!membership || !["owner", "lead"].includes(membership.role)) {
    throw new ForbiddenException("Catalog import requires owner or lead");
  }
  await lockDevelopmentImportTx(tx, userId, workspaceId);
  const externalIds = new Set<string>();
  const normalizedTitles = new Set<string>();
  for (const project of projects) {
    if (!project || typeof project.externalId !== "string" || !project.externalId.trim() ||
        typeof project.title !== "string" || !project.title.trim() ||
        (project.confirmedExistingId !== undefined && (!project.confirmedExistingId || typeof project.confirmedExistingId !== "string"))) {
      throw new ConflictException("Invalid catalog project");
    }
    const titleKey = project.title.trim().toLowerCase();
    if (externalIds.has(project.externalId) || normalizedTitles.has(titleKey)) {
      throw new ConflictException("Duplicate catalog project");
    }
    externalIds.add(project.externalId);
    normalizedTitles.add(titleKey);
  }

  const results: ProjectImportResult[] = [];
  for (const project of projects) {
    const mapped = await tx.developmentCatalogMapping.findUnique({
      where: { workspaceId_catalogId_kind_externalId: {
        workspaceId, catalogId, kind: "project", externalId: project.externalId
      } }
    });
    if (mapped) {
      const target = await developmentProjectCatalog.byIdTx(tx, workspaceId, mapped.entityId);
      if (!target || (project.confirmedExistingId && project.confirmedExistingId !== target.id)) {
        throw new ConflictException("Stale or conflicting project mapping");
      }
      results.push({ externalId: project.externalId, entityId: target.id, outcome: "already_mapped" });
      continue;
    }

    const matches = await developmentProjectCatalog.byNameTx(tx, workspaceId, project.title.trim());
    if (matches.length > 1) throw new ConflictException("Ambiguous existing project");
    let entityId: string;
    let outcome: ProjectImportResult["outcome"];
    if (project.confirmedExistingId) {
      if (matches.length !== 1 || matches[0]?.id !== project.confirmedExistingId) {
        throw new ConflictException("Existing project confirmation is stale");
      }
      entityId = project.confirmedExistingId;
      outcome = "confirmed_existing";
    } else {
      if (matches.length) throw new ConflictException("Existing project requires explicit confirmation");
      const created = await developmentProjectCatalog.createTx(tx, workspaceId, project.title.trim());
      entityId = created.id;
      outcome = "created";
    }
    await bindCatalogEntityTx(tx, userId, {
      workspaceId, catalogId, kind: "project", externalId: project.externalId, entityId
    });
    results.push({ externalId: project.externalId, entityId, outcome });
  }
  return results;
}

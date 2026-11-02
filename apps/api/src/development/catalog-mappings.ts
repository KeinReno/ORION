import { lockDevelopmentImportTx } from "./catalog-write-lock";
import { developmentProjectCatalog } from "../projects/public/development-catalog";
import { developmentTaskCatalog } from "../tasks/public/development-catalog";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export interface CatalogBinding {
  workspaceId: string;
  catalogId: string;
  kind: "project" | "task";
  externalId: string;
  entityId: string;
}

/** Transactional binding primitive. Caller supplies explicit user confirmation. */
export async function bindCatalogEntityTx(
  tx: Prisma.TransactionClient,
  userId: string,
  input: CatalogBinding
): Promise<{ id: string; alreadyBound: boolean }> {
  if (!input.workspaceId || !input.catalogId || !input.externalId || !input.entityId ||
    (input.kind !== "project" && input.kind !== "task")) {
    throw new ConflictException("Invalid catalog binding");
  }
  const membership = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: input.workspaceId, userId } }
  });
  if (!membership || !["owner", "lead"].includes(membership.role)) {
    throw new ForbiddenException("Catalog mapping write not permitted");
  }
  await lockDevelopmentImportTx(tx, userId, input.workspaceId);
  const target = input.kind === "project"
    ? await developmentProjectCatalog.byIdTx(tx, input.workspaceId, input.entityId)
    : await developmentTaskCatalog.byIdTx(tx, input.workspaceId, input.entityId);
  if (!target) throw new NotFoundException("Catalog target not found in workspace");
  const existing = await tx.developmentCatalogMapping.findFirst({
    where: {
      workspaceId: input.workspaceId, catalogId: input.catalogId, kind: input.kind,
      OR: [{ externalId: input.externalId }, { entityId: input.entityId }]
    }
  });
  if (existing) {
    if (existing.externalId !== input.externalId || existing.entityId !== input.entityId) {
      throw new ConflictException("Conflicting catalog binding");
    }
    return { id: existing.id, alreadyBound: true };
  }
  const created = await tx.developmentCatalogMapping.create({ data: input });
  return { id: created.id, alreadyBound: false };
}

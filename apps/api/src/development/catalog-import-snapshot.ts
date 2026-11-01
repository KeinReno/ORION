import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/**
 * Read-only snapshot for the catalog dry-run planner.
 * Caller invokes inside PrismaService.withUser(userId, ...) and passes
 * the returned data to the existing planOrionDevImport planner.
 * This deliberately does not infer workspace ownership by its name.
 */
export async function readDevelopmentImportSnapshotTx(
  tx: Prisma.TransactionClient,
  userId: string,
  workspaceId: string,
  catalogId: string
) {
  if (!workspaceId || !catalogId) throw new NotFoundException("Workspace or catalog not specified");
  const membership = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } }
  });
  if (!membership || (membership.role !== "owner" && membership.role !== "lead")) {
    throw new ForbiddenException("Development import preview requires owner or lead");
  }
  const workspace = await tx.workspace.findUnique({
    where: { id: workspaceId }, select: { id: true, name: true }
  });
  if (!workspace) throw new NotFoundException("Workspace not found");
  const [projects, tasks, bindings] = await Promise.all([
    tx.project.findMany({
      where: { workspaceId },
      select: { id: true, workspaceId: true, name: true },
      orderBy: { id: "asc" }
    }),
    tx.task.findMany({
      where: { workspaceId },
      select: { id: true, workspaceId: true, projectId: true, title: true },
      orderBy: { id: "asc" }
    }),
    tx.developmentCatalogMapping.findMany({
      where: { workspaceId, catalogId },
      select: {
        workspaceId: true, catalogId: true, kind: true,
        externalId: true, entityId: true
      },
      orderBy: [{ kind: "asc" }, { externalId: "asc" }]
    })
  ]);
  return {
    targetWorkspaceId: workspaceId,
    workspaces: [workspace],
    projects,
    tasks,
    mappings: bindings
  };
}

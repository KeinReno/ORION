import { developmentProjectCatalog } from "../projects/public/development-catalog";
import { developmentTaskCatalog } from "../tasks/public/development-catalog";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ModulesService } from "../modules/modules.service";

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
  catalogId: string,
  modules: ModulesService
) {
  if (!workspaceId || !catalogId) throw new NotFoundException("Workspace or catalog not specified");
  const membership = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } }
  });
  if (!membership || (membership.role !== "owner" && membership.role !== "lead")) {
    throw new ForbiddenException("Development import preview requires owner or lead");
  }
  const workspace = await tx.workspace.findUnique({
    where: { id: workspaceId }, select: { id: true, name: true, disabledModules: true, restrictedModules: true }
  });
  if (!workspace) throw new NotFoundException("Workspace not found");
  await modules.assertEnabledTx(tx, userId, workspaceId, "projects");
  await modules.assertEnabledTx(tx, userId, workspaceId, "tasks");
  await modules.assertEnabledTx(tx, userId, workspaceId, "orion-dev");
  const [projects, tasks, bindings, dependencies] = await Promise.all([
    developmentProjectCatalog.listTx(tx, workspaceId),
    developmentTaskCatalog.listTx(tx, workspaceId),
    tx.developmentCatalogMapping.findMany({
      where: { workspaceId, catalogId },
      select: {
        workspaceId: true, catalogId: true, kind: true,
        externalId: true, entityId: true
      },
      orderBy: [{ kind: "asc" }, { externalId: "asc" }]
    }),
    developmentTaskCatalog.edgesTx(tx, workspaceId)
  ]);
  return {
    targetWorkspaceId: workspaceId,
    workspaces: [workspace],
    projects: projects.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
    tasks: tasks.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
    dependencies,
    mappings: bindings
  };
}

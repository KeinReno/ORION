import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { bindCatalogEntityTx } from "./catalog-mappings";

export interface ConfirmedCatalogTask {
  externalId: string;
  projectExternalId: string;
  title: string;
  confirmedExistingId?: string;
}

export interface TaskImportResult {
  externalId: string;
  entityId: string;
  outcome: "created" | "already_mapped" | "confirmed_existing";
}

/**
 * Atomic canonical task import stage. Requires a previously validated catalog,
 * explicitly confirmed workspace and user-approved matches. Invoke only inside
 * PrismaService.withUser. This primitive is not exposed as a public endpoint.
 * Dependencies are deliberately deferred until all task IDs have been mapped.
 */
export async function importConfirmedCatalogTasksTx(
  tx: Prisma.TransactionClient,
  userId: string,
  workspaceId: string,
  catalogId: string,
  tasks: readonly ConfirmedCatalogTask[]
): Promise<TaskImportResult[]> {
  if (!workspaceId || !catalogId || !Array.isArray(tasks)) throw new ConflictException("Invalid task import");
  const member = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } }
  });
  if (!member || (member.role !== "owner" && member.role !== "lead")) {
    throw new ForbiddenException("Task import requires owner or lead");
  }
  const ids = new Set<string>();
  const titles = new Set<string>();
  for (const task of tasks) {
    if (!task || typeof task.externalId !== "string" || !task.externalId.trim() ||
      typeof task.projectExternalId !== "string" || !task.projectExternalId.trim() ||
      typeof task.title !== "string" || !task.title.trim() ||
      (task.confirmedExistingId !== undefined &&
        (typeof task.confirmedExistingId !== "string" || !task.confirmedExistingId.trim()))) {
      throw new ConflictException("Invalid catalog task");
    }
    const titleKey = JSON.stringify([task.projectExternalId, task.title.trim().toLowerCase()]);
    if (ids.has(task.externalId) || titles.has(titleKey)) throw new ConflictException("Duplicate catalog task");
    ids.add(task.externalId);
    titles.add(titleKey);
  }
  const results: TaskImportResult[] = [];
  for (const task of tasks) {
    const projectBinding = await tx.developmentCatalogMapping.findUnique({
      where: { workspaceId_catalogId_kind_externalId: {
        workspaceId, catalogId, kind: "project", externalId: task.projectExternalId
      } }
    });
    if (!projectBinding) throw new ConflictException("Project must be mapped before task import");
    const project = await tx.project.findFirst({
      where: { id: projectBinding.entityId, workspaceId }, select: { id: true, name: true }
    });
    if (!project) throw new ConflictException("Stale project mapping");
    const binding = await tx.developmentCatalogMapping.findUnique({
      where: { workspaceId_catalogId_kind_externalId: {
        workspaceId, catalogId, kind: "task", externalId: task.externalId
      } }
    });
    if (binding) {
      const existing = await tx.task.findFirst({
        where: { id: binding.entityId, workspaceId, projectId: project.id }, select: { id: true }
      });
      if (!existing || (task.confirmedExistingId && task.confirmedExistingId !== existing.id)) {
        throw new ConflictException("Stale or conflicting task mapping");
      }
      results.push({ externalId: task.externalId, entityId: existing.id, outcome: "already_mapped" });
      continue;
    }
    const matches = await tx.task.findMany({
      where: { workspaceId, projectId: project.id, title: { equals: task.title.trim(), mode: "insensitive" } },
      select: { id: true }
    });
    if (matches.length > 1) throw new ConflictException("Ambiguous existing task");
    let entityId: string;
    let outcome: TaskImportResult["outcome"];
    if (task.confirmedExistingId) {
      if (matches.length !== 1 || matches[0]?.id !== task.confirmedExistingId) {
        throw new ConflictException("Existing task confirmation is stale");
      }
      entityId = task.confirmedExistingId;
      outcome = "confirmed_existing";
    } else {
      if (matches.length) throw new ConflictException("Existing task requires explicit confirmation");
      const created = await tx.task.create({
        data: { workspaceId, projectId: project.id, projectTag: project.name, title: task.title.trim() },
        select: { id: true }
      });
      entityId = created.id;
      outcome = "created";
    }
    await bindCatalogEntityTx(tx, userId, {
      workspaceId, catalogId, kind: "task", externalId: task.externalId, entityId
    });
    results.push({ externalId: task.externalId, entityId, outcome });
  }
  return results;
}

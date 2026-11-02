import { lockDevelopmentImportTx } from "./catalog-write-lock";
import { developmentTaskCatalog } from "../tasks/public/development-catalog";
import type { TaskOperations } from "../tasks/public/task-operations";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export interface CatalogTaskDependencies {
  externalId: string;
  dependsOn: readonly string[];
}

/**
 * Add only missing canonical task dependency edges. Never delete manually
 * maintained edges. Invoke after all task mappings exist, in withUser().
 * Caller must validate the versioned catalog and obtain explicit consent.
 */
export async function linkCatalogTaskDependenciesTx(
  tx: Prisma.TransactionClient,
  userId: string,
  workspaceId: string,
  catalogId: string,
  tasks: readonly CatalogTaskDependencies[],
  commands?: TaskOperations
): Promise<{ created: number; existing: number }> {
  if (!workspaceId || !catalogId || !Array.isArray(tasks)) throw new ConflictException("Invalid dependency import");
  const member = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } }
  });
  if (!member || (member.role !== "owner" && member.role !== "lead")) {
    throw new ForbiddenException("Dependency import requires owner or lead");
  }
  await lockDevelopmentImportTx(tx, userId, workspaceId);
  const ids = new Set<string>();
  for (const task of tasks) {
    if (!task || typeof task.externalId !== "string" || !task.externalId.trim() ||
        !Array.isArray(task.dependsOn) ||
        task.dependsOn.some((id: unknown) => typeof id !== "string" || !id.trim()) ||
        new Set(task.dependsOn).size !== task.dependsOn.length ||
        ids.has(task.externalId)) {
      throw new ConflictException("Invalid catalog dependency declaration");
    }
    ids.add(task.externalId);
  }
  const requested = new Map(tasks.map((task) => [task.externalId, task.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new ConflictException("Catalog dependency cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of requested.get(id) ?? []) {
      if (dependency === id) throw new ConflictException("Self dependency");
      if (requested.has(dependency)) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of requested.keys()) visit(id);

  const referenced = [...new Set(tasks.flatMap((task) => [task.externalId, ...task.dependsOn]))];
  const bindings = await tx.developmentCatalogMapping.findMany({
    where: { workspaceId, catalogId, kind: "task", externalId: { in: referenced } }
  });
  const mapping = new Map(bindings.map((binding) => [binding.externalId, binding.entityId]));
  if (mapping.size !== referenced.length) throw new ConflictException("Missing catalog task mapping");
  const canonicalIds = [...new Set(mapping.values())];
  if (canonicalIds.length !== referenced.length) throw new ConflictException("Ambiguous canonical task mapping");
  await developmentTaskCatalog.lockGraphTx(tx, workspaceId);
  const owned = await developmentTaskCatalog.idsTx(tx, workspaceId, canonicalIds);
  if (owned.length !== canonicalIds.length) throw new ConflictException("Stale catalog task mapping");
  const revisions = new Map(owned.map(task => [task.id, task.revision]));

  // Check the full canonical graph, including manually maintained edges.
  // This prevents a new catalog edge from introducing a cycle through an
  // existing non-catalog task.
  const edges = await developmentTaskCatalog.edgesTx(tx, workspaceId);
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!graph.has(edge.taskId)) graph.set(edge.taskId, new Set());
    graph.get(edge.taskId)!.add(edge.dependsOnTaskId);
  }
  let created = 0;
  let existing = 0;
  const reaches = (from: string, target: string): boolean => {
    const stack = [from];
    const seen = new Set<string>();
    while (stack.length) {
      const current = stack.pop()!;
      if (current === target) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of graph.get(current) ?? []) stack.push(next);
    }
    return false;
  };
  for (const task of tasks) {
    const taskId = mapping.get(task.externalId)!;
    for (const dependency of task.dependsOn) {
      const dependencyId = mapping.get(dependency)!;
      if (graph.get(taskId)?.has(dependencyId)) { existing++; continue; }
      if (reaches(dependencyId, taskId)) throw new ConflictException("Canonical task dependency cycle");
      if (!commands) throw new ConflictException("Canonical TaskOperations required for dependency writes");
      await commands.updateTx(tx, userId, workspaceId, taskId, {
        dependencyIds: [...(graph.get(taskId) ?? []), dependencyId],
        expectedRevision: revisions.get(taskId)!
      });
      revisions.set(taskId, revisions.get(taskId)! + 1);
      if (!graph.has(taskId)) graph.set(taskId, new Set());
      graph.get(taskId)!.add(dependencyId);
      created++;
    }
  }
  return { created, existing };
}

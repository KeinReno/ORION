import type { Prisma } from "@prisma/client";

/** Read-only catalog projections; mutations use canonical TaskOperations. */
export const developmentTaskCatalog = {
  listTx: (tx: Prisma.TransactionClient, workspaceId: string) => tx.task.findMany({
    where: { workspaceId }, select: { id: true, workspaceId: true, projectId: true, title: true, revision: true, updatedAt: true }, orderBy: { id: "asc" }
  }),
  byIdTx: (tx: Prisma.TransactionClient, workspaceId: string, id: string, projectId?: string) => tx.task.findFirst({
    where: { id, workspaceId, ...(projectId === undefined ? {} : { projectId }) }, select: { id: true }
  }),
  byTitleTx: (tx: Prisma.TransactionClient, workspaceId: string, projectId: string, title: string) => tx.task.findMany({
    where: { workspaceId, projectId, title: { equals: title, mode: "insensitive" } }, select: { id: true }
  }),
  idsTx: (tx: Prisma.TransactionClient, workspaceId: string, ids: string[]) => tx.task.findMany({
    where: { workspaceId, id: { in: ids } }, select: { id: true, revision: true }
  }),
  lockGraphTx: (tx: Prisma.TransactionClient, workspaceId: string) => tx.$queryRaw`
    SELECT id FROM tasks WHERE "workspaceId" = ${workspaceId} ORDER BY id FOR UPDATE`,
  edgesTx: (tx: Prisma.TransactionClient, workspaceId: string) => tx.taskDependency.findMany({
    where: { workspaceId }, select: { taskId: true, dependsOnTaskId: true },
    orderBy: [{ taskId: "asc" }, { dependsOnTaskId: "asc" }]
  })
};

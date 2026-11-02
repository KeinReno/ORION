import type { Prisma } from "@prisma/client";

/** Fixed catalog projections in the caller's existing authorization/RLS transaction. */
export const developmentProjectCatalog = {
  listTx: (tx: Prisma.TransactionClient, workspaceId: string) => tx.project.findMany({
    where: { workspaceId }, select: { id: true, workspaceId: true, name: true }, orderBy: { id: "asc" }
  }),
  byIdTx: (tx: Prisma.TransactionClient, workspaceId: string, id: string) => tx.project.findFirst({
    where: { id, workspaceId }, select: { id: true, name: true }
  }),
  byNameTx: (tx: Prisma.TransactionClient, workspaceId: string, name: string) => tx.project.findMany({
    where: { workspaceId, name: { equals: name, mode: "insensitive" } }, select: { id: true }
  }),
  createTx: (tx: Prisma.TransactionClient, workspaceId: string, name: string) => tx.project.create({
    data: { workspaceId, name }, select: { id: true }
  })
};

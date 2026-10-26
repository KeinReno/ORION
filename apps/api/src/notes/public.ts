import type { Prisma } from "@prisma/client";

/** Public read contract for source links. Uses the caller's user-scoped transaction. */
export async function readKnowledgeSourceTitle(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<string | null> {
  const row = await tx.note.findFirst({
    where: { id, workspaceId, deletedAt: null },
    select: { title: true }
  });
  return row?.title ?? null;
}

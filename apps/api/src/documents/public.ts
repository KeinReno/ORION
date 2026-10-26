import type { Prisma } from "@prisma/client";

/** Public read contract for source links. Uses the caller's user-scoped transaction. */
export async function readKnowledgeSourceTitle(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<string | null> {
  const row = await tx.document.findFirst({
    where: { id, workspaceId, deletedAt: null, kind: "file" },
    select: { name: true }
  });
  return row?.name ?? null;
}

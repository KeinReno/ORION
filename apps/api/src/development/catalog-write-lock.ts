import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/** Serialize catalog writes per workspace before looking up identities/edges.
 * The transaction retains the role row lock until commit or rollback. */
export async function lockDevelopmentImportTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string) {
  await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
  const members = await tx.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM workspace_members
    WHERE "workspaceId" = ${workspaceId} AND "userId" = ${userId}
      AND role IN ('owner', 'lead') FOR UPDATE`;
  if (members.length !== 1) throw new ForbiddenException("Development import requires owner or lead");
}

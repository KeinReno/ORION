import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/**
 * Tasks, lists, things and payments may point at a home (`homeId`). A member of two spaces sees both
 * homes through RLS, so "the id exists" is not enough: it must be a home of THIS workspace.
 */
export async function assertHomeInWorkspace(tx: Prisma.TransactionClient, workspaceId: string, homeId: string): Promise<void> {
  const home = await tx.home.findUnique({ where: { id: homeId } });
  if (!home || home.workspaceId !== workspaceId) {
    throw new BadRequestException("Дом не найден в этом рабочем пространстве");
  }
}

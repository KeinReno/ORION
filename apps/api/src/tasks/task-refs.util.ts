import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/** Same shape as finance-refs.util.ts's assertAccountInWorkspace — a cross-ref must belong to this same workspace. */
export async function assertAssigneeInWorkspace(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  memberId: string
): Promise<void> {
  const member = await tx.workspaceMember.findUnique({ where: { id: memberId } });
  if (!member || member.workspaceId !== workspaceId) {
    throw new BadRequestException("Исполнитель не найден в этом рабочем пространстве");
  }
}

import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ProjectReferences } from "../projects/public/project-references";

/**
 * Ссылки материала на объекты ЭТОГО пространства (задание 06). RLS не спасает от
 * смешивания двух пространств, где пользователь — участник обоих, поэтому принадлежность
 * проверяется явно. Вынесено из сервиса, чтобы импорт/маршрутизация входящих проверяли
 * ровно так же, как обычное создание.
 */

export async function assertKnowledgeCategoryTx(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  categoryId: string | null | undefined
): Promise<void> {
  if (!categoryId) return;
  const row = await tx.knowledgeCategory.findFirst({ where: { id: categoryId, workspaceId }, select: { id: true } });
  if (!row) throw new BadRequestException("Раздел не найден в этом пространстве");
}

export async function assertKnowledgeProjectTx(
  tx: Prisma.TransactionClient,
  projectReferences: ProjectReferences,
  workspaceId: string,
  projectId: string | null | undefined
): Promise<void> {
  if (!projectId) return;
  if (!(await projectReferences.existsTx(tx, workspaceId, projectId))) throw new NotFoundException("Проект не найден");
}

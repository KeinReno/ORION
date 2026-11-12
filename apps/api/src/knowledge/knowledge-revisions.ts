import { Prisma } from "@prisma/client";

/**
 * Чистые операции истории версий (задание 06, п. 6.3): снимок текущего состояния
 * и обрезка до лимита хранения. Живут отдельно от сервисов, потому что нужны и
 * обычному сохранению (публикация), и восстановлению, и явному «сохранить версию».
 */

export interface RevisionSource {
  id: string;
  workspaceId: string;
  revision: number;
  title: string;
  summary: string;
  body: string;
  origin: Prisma.JsonValue | null;
}

/** Пишет снимок материала. `restoredFromId` — если снимок создан восстановлением старой версии. */
export async function snapshotKnowledgeRevisionTx(
  tx: Prisma.TransactionClient,
  item: RevisionSource,
  authorId: string,
  restoredFromId: string | null = null
) {
  return tx.knowledgeItemRevision.create({
    data: {
      workspaceId: item.workspaceId,
      itemId: item.id,
      revision: item.revision,
      title: item.title,
      summary: item.summary,
      body: item.body,
      authorId,
      restoredFromId,
      ...(item.origin === null ? {} : { origin: item.origin as Prisma.InputJsonValue })
    }
  });
}

/** Оставляет последние `limit` снимков материала; остальные удаляются (история не «сжимается» иначе). */
export async function pruneKnowledgeRevisionsTx(
  tx: Prisma.TransactionClient,
  itemId: string,
  limit: number
): Promise<number> {
  const keep = Math.max(1, limit);
  const stale = await tx.knowledgeItemRevision.findMany({
    where: { itemId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: keep,
    select: { id: true }
  });
  if (stale.length === 0) return 0;
  const deleted = await tx.knowledgeItemRevision.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
  return deleted.count;
}

/** Снимок считается значимым, если текст/происхождение действительно отличаются от текущих. */
export function revisionDiffers(
  revision: { title: string; summary: string; body: string; origin: Prisma.JsonValue | null },
  item: { title: string; summary: string; body: string; origin: Prisma.JsonValue | null }
): boolean {
  return (
    revision.title !== item.title ||
    revision.summary !== item.summary ||
    revision.body !== item.body ||
    JSON.stringify(revision.origin ?? null) !== JSON.stringify(item.origin ?? null)
  );
}

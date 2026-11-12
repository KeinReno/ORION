import { Injectable, Module } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/**
 * Публичный read-only контракт Shared для соседних модулей (задание 02, 2.2):
 * «есть ли активная публикация этой записи и кто её автор». Tasks не читает
 * `shared_publications` напрямую и не импортирует внутренности Shared — только
 * этот контракт в исходной транзакции/RLS вызывающего.
 */
export interface PublishedSourceRef {
  publisherId: string;
}

@Injectable()
export class PublishedSources {
  /** sourceId → publisherId для активных (не отозванных) публикаций указанного вида. */
  async activeBySourceTx(
    tx: Prisma.TransactionClient,
    params: { sourceWorkspaceId: string; kind: string; sourceIds: readonly string[] }
  ): Promise<Map<string, PublishedSourceRef>> {
    if (!params.sourceIds.length) return new Map();
    const rows = await tx.sharedPublication.findMany({
      where: {
        kind: params.kind,
        sourceWorkspaceId: params.sourceWorkspaceId,
        sourceId: { in: [...params.sourceIds] },
        revokedAt: null
      },
      select: { sourceId: true, publisherId: true }
    });
    return new Map(rows.map((row) => [row.sourceId, { publisherId: row.publisherId }]));
  }
}

@Module({ providers: [PublishedSources], exports: [PublishedSources] })
export class PublishedSourcesModule {}

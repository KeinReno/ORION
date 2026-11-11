import { Injectable, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { GlobalSearchResult } from "@orion/shared-types";
import { SearchProviderRegistry } from "../search/search-provider.registry";
import { type SearchProvider, searchResult } from "../search/search-provider";

/** Русская подпись вида материала для подзаголовка результата. */
const KNOWLEDGE_KIND_LABEL: Record<string, string> = {
  method: "метод",
  tool: "инструмент",
  fact: "факт",
  opinion: "мнение",
  link: "ссылка"
};

/**
 * Адаптер базы знаний в глобальный поиск (задание 10.2). Отдельный endpoint
 * Knowledge (`GET …/knowledge/search`) остаётся для своей панели; здесь —
 * тот же `searchVector` (tsvector, задание 06), но результат приводится к
 * общему контракту провайдера.
 *
 * Провайдер живёт в модуле-владельце, ядро поиска таблиц `knowledge_items` не
 * читает. Приватные материалы другого автора отфильтрованы по
 * `current_setting('app.current_user_id')` — RLS проверяет только членство, а
 * видимость материала задаётся его `visibility`.
 */
@Injectable()
export class KnowledgeSearchProvider implements SearchProvider, OnModuleInit {
  readonly entityType = "knowledge_item" as const;
  readonly componentId = "knowledge" as const;

  constructor(private readonly registry: SearchProviderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    query: string,
    limit: number
  ): Promise<GlobalSearchResult[]> {
    const hits = await tx.$queryRaw<
      Array<{ id: string; title: string; kind: string; projectId: string | null; snippet: string; updatedAt: Date }>
    >(Prisma.sql`
      SELECT "id",
             "title",
             "kind",
             "projectId",
             ts_headline(
               'russian',
               "title" || '. ' || "summary" || '. ' || "body",
               websearch_to_tsquery('russian', lower(${query})),
               'StartSel=, StopSel=, MaxFragments=1, MaxWords=24, MinWords=8, HighlightAll=false'
             ) AS "snippet",
             "updatedAt"
      FROM "knowledge_items"
      WHERE "workspaceId" = ${workspaceId}
        AND "status" <> 'archived'
        AND ("visibility" <> 'private' OR "createdBy" = current_setting('app.current_user_id', true))
        AND "searchVector" @@ websearch_to_tsquery('russian', lower(${query}))
      ORDER BY ts_rank("searchVector", websearch_to_tsquery('russian', lower(${query}))) DESC, "updatedAt" DESC
      LIMIT ${limit}
    `);
    return hits.map((hit) =>
      searchResult(
        "knowledge_item",
        hit.id,
        hit.title,
        KNOWLEDGE_KIND_LABEL[hit.kind] ?? hit.kind,
        hit.snippet,
        hit.projectId,
        hit.updatedAt
      )
    );
  }
}

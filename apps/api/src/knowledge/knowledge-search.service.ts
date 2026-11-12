import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { KnowledgeSearchQuery, KnowledgeSearchResult } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { toItem } from "./knowledge-dto";
import { KnowledgeSettingsService } from "./knowledge-settings.service";

/** Сколько материалов отдаёт поиск за один запрос. */
const KNOWLEDGE_SEARCH_LIMIT = 50;

/**
 * Полнотекстовый поиск по базе знаний (задание 06, п. 6.2). Ищет по материализованному
 * `searchVector` (конфигурация russian; триггер миграции обновляет его при записи).
 * `websearch_to_tsquery` не падает на произвольном вводе. Точная фраза поднимается над
 * остальными совпадениями (`phraseto_tsquery`), затем идёт `ts_rank` с весами полей.
 * Сниппет — `ts_headline` с `<b>…</b>` вокруг совпадений.
 *
 * Текст запроса и документа приводится к нижнему регистру: база создана с локалью C,
 * где `to_tsvector('russian', …)` сохраняет заглавные кириллические лексемы. Триггер
 * миграции хранит вектор из `lower(...)`, поэтому и запрос идёт через `lower($term)`.
 *
 * Отдельный endpoint, а не провайдер глобального поиска: контракт провайдера
 * формализует задание 10, до него Knowledge не расширяет `SearchableEntityType`.
 */
@Injectable()
export class KnowledgeSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly settings: KnowledgeSettingsService
  ) {}

  search(userId: string, workspaceId: string, query: KnowledgeSearchQuery): Promise<KnowledgeSearchResult[]> {
    const term = query.q.trim();
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      if (term.length < 2) return [];
      const settings = await this.settings.readTx(tx, workspaceId);
      const now = new Date();
      const cutoff = new Date(now.getTime() - settings.verificationDays * 86_400_000);

      const filters: Prisma.Sql[] = [
        Prisma.sql`"workspaceId" = ${workspaceId}`,
        Prisma.sql`"status" <> 'archived'`,
        Prisma.sql`"searchVector" @@ websearch_to_tsquery('russian', lower(${term}))`
      ];
      if (query.type) filters.push(Prisma.sql`"kind" = ${query.type}`);
      if (query.projectId) filters.push(Prisma.sql`"projectId" = ${query.projectId}`);
      if (query.from) filters.push(Prisma.sql`"updatedAt" >= ${new Date(query.from)}`);
      if (query.to) filters.push(Prisma.sql`"updatedAt" <= ${new Date(query.to)}`);
      if (query.verified === "true") {
        filters.push(Prisma.sql`"verificationState" = 'verified' AND "lastVerifiedAt" IS NOT NULL AND "lastVerifiedAt" >= ${cutoff}`);
      }
      if (query.verified === "false") {
        filters.push(Prisma.sql`("verificationState" <> 'verified' OR "lastVerifiedAt" IS NULL OR "lastVerifiedAt" < ${cutoff})`);
      }

      const hits = await tx.$queryRaw<Array<{ id: string; rank: number; snippet: string }>>(Prisma.sql`
        SELECT "id",
               ts_rank("searchVector", websearch_to_tsquery('russian', lower(${term})))::float8 AS rank,
               ts_headline(
                 'russian',
                 "title" || '. ' || "summary" || '. ' || "body",
                 websearch_to_tsquery('russian', lower(${term})),
                 'StartSel=<b>, StopSel=</b>, MaxFragments=1, MaxWords=24, MinWords=8, HighlightAll=false'
               ) AS "snippet"
        FROM "knowledge_items"
        WHERE ${Prisma.join(filters, " AND ")}
        ORDER BY ("searchVector" @@ phraseto_tsquery('russian', lower(${term}))) DESC, rank DESC, "updatedAt" DESC
        LIMIT ${KNOWLEDGE_SEARCH_LIMIT}
      `);
      if (hits.length === 0) return [];

      const ids = hits.map((hit) => hit.id);
      const items = await tx.knowledgeItem.findMany({ where: { workspaceId, id: { in: ids } } });
      const byId = new Map(items.map((item) => [item.id, item]));
      const results: KnowledgeSearchResult[] = [];
      for (const hit of hits) {
        const item = byId.get(hit.id);
        // Строку могла скрыть RLS (приватный материал другого автора) — в выдачу она не попадает.
        if (!item) continue;
        results.push({ ...toItem(item, settings, now), rank: Number(hit.rank), snippet: hit.snippet });
      }
      return results;
    });
  }
}

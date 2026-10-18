import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { GlobalSearchResult } from "@orion/shared-types";
import { SearchProviderRegistry } from "../search/search-provider.registry";
import { type SearchProvider, searchResult } from "../search/search-provider";

/** G19: поиск по этому типу живёт в своём модуле; ядро поиска (`SearchService`) таблиц не трогает. */
@Injectable()
export class NotesSearchProvider implements SearchProvider, OnModuleInit {
  readonly entityType = "note" as const;
  readonly componentId = "notes" as const;

  constructor(private readonly registry: SearchProviderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(tx: Prisma.TransactionClient, workspaceId: string, query: string, limit: number): Promise<GlobalSearchResult[]> {
    const rows = await tx.note.findMany({ where: { workspaceId, deletedAt: null, isTemplate: false, OR: [{ title: { contains: query, mode: "insensitive" } }, { summary: { contains: query, mode: "insensitive" } }, { body: { contains: query, mode: "insensitive" } }] }, take: limit, orderBy: { updatedAt: "desc" } });
    return rows.map((item) => searchResult("note", item.id, item.title, item.tags.join(" · "), item.body, item.projectId, item.updatedAt));
  }
}

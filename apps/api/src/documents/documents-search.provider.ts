import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { GlobalSearchResult } from "@orion/shared-types";
import { SearchProviderRegistry } from "../search/search-provider.registry";
import { type SearchProvider, searchResult } from "../search/search-provider";

/** G19: поиск по этому типу живёт в своём модуле; ядро поиска (`SearchService`) таблиц не трогает. */
@Injectable()
export class DocumentsSearchProvider implements SearchProvider, OnModuleInit {
  readonly entityType = "document" as const;
  readonly componentId = "documents" as const;

  constructor(private readonly registry: SearchProviderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(tx: Prisma.TransactionClient, workspaceId: string, query: string, limit: number): Promise<GlobalSearchResult[]> {
    const rows = await tx.document.findMany({ where: { workspaceId, deletedAt: null, OR: [{ name: { contains: query, mode: "insensitive" } }, { extractedText: { contains: query, mode: "insensitive" } }] }, take: limit, orderBy: { updatedAt: "desc" } });
    return rows.map((item) => searchResult("document", item.id, item.name, item.mimeType ?? "Папка", item.extractedText, item.projectId, item.updatedAt));
  }
}

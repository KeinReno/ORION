import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { GlobalSearchResult } from "@orion/shared-types";
import { SearchProviderRegistry } from "../search/search-provider.registry";
import { type SearchProvider, searchResult } from "../search/search-provider";

/** G19: поиск по этому типу живёт в своём модуле; ядро поиска (`SearchService`) таблиц не трогает. */
@Injectable()
export class ListsSearchProvider implements SearchProvider, OnModuleInit {
  readonly entityType = "list" as const;
  readonly componentId = "lists" as const;

  constructor(private readonly registry: SearchProviderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(tx: Prisma.TransactionClient, workspaceId: string, query: string, limit: number): Promise<GlobalSearchResult[]> {
    const rows = await tx.list.findMany({
      where: { workspaceId, archivedAt: null, OR: [{ name: { contains: query, mode: "insensitive" } }, { items: { some: { label: { contains: query, mode: "insensitive" } } } }] },
      include: { items: { where: { label: { contains: query, mode: "insensitive" } }, select: { label: true }, take: 3 } },
      take: limit,
      orderBy: { updatedAt: "desc" }
    });
    return rows.map((item) => searchResult("list", item.id, item.name, item.isTemplate ? "Шаблон списка" : "Список", item.items.map((entry) => entry.label).join(" · "), null, item.updatedAt));
  }
}

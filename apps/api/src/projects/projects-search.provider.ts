import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { GlobalSearchResult } from "@orion/shared-types";
import { SearchProviderRegistry } from "../search/search-provider.registry";
import { type SearchProvider, searchResult, searchStatusLabel } from "../search/search-provider";

/** G19: поиск по этому типу живёт в своём модуле; ядро поиска (`SearchService`) таблиц не трогает. */
@Injectable()
export class ProjectsSearchProvider implements SearchProvider, OnModuleInit {
  readonly entityType = "project" as const;
  readonly componentId = "projects" as const;

  constructor(private readonly registry: SearchProviderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(tx: Prisma.TransactionClient, workspaceId: string, query: string, limit: number): Promise<GlobalSearchResult[]> {
    const rows = await tx.project.findMany({ where: { workspaceId, archivedAt: null, OR: [{ name: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] }, take: limit, orderBy: { updatedAt: "desc" } });
    return rows.map((item) => searchResult("project", item.id, item.name, searchStatusLabel(item.status), item.description, item.id, item.updatedAt));
  }
}

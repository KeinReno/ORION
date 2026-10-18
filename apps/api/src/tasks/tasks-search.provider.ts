import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { GlobalSearchResult } from "@orion/shared-types";
import { SearchProviderRegistry } from "../search/search-provider.registry";
import { type SearchProvider, searchResult, searchStatusLabel } from "../search/search-provider";

/** G19: поиск по этому типу живёт в своём модуле; ядро поиска (`SearchService`) таблиц не трогает. */
@Injectable()
export class TasksSearchProvider implements SearchProvider, OnModuleInit {
  readonly entityType = "task" as const;
  readonly componentId = "tasks" as const;

  constructor(private readonly registry: SearchProviderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(tx: Prisma.TransactionClient, workspaceId: string, query: string, limit: number): Promise<GlobalSearchResult[]> {
    const rows = await tx.task.findMany({ where: { workspaceId, OR: [{ title: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] }, take: limit, orderBy: { updatedAt: "desc" } });
    return rows.map((item) => searchResult("task", item.id, item.title, searchStatusLabel(item.status), item.description, item.projectId, item.updatedAt));
  }
}

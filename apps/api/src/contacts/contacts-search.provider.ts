import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { GlobalSearchResult } from "@orion/shared-types";
import { SearchProviderRegistry } from "../search/search-provider.registry";
import { type SearchProvider, searchResult } from "../search/search-provider";

/** G19: поиск по этому типу живёт в своём модуле; ядро поиска (`SearchService`) таблиц не трогает. */
@Injectable()
export class ContactsSearchProvider implements SearchProvider, OnModuleInit {
  readonly entityType = "contact" as const;
  readonly componentId = "contacts" as const;

  constructor(private readonly registry: SearchProviderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(tx: Prisma.TransactionClient, workspaceId: string, query: string, limit: number): Promise<GlobalSearchResult[]> {
    const rows = await tx.contact.findMany({ where: { workspaceId, OR: [{ name: { contains: query, mode: "insensitive" } }, { role: { contains: query, mode: "insensitive" } }, { phone: { contains: query } }, { email: { contains: query, mode: "insensitive" } }, { organization: { contains: query, mode: "insensitive" } }, { address: { contains: query, mode: "insensitive" } }, { tags: { has: query } }, { note: { contains: query, mode: "insensitive" } }] }, take: limit, orderBy: { updatedAt: "desc" } });
    return rows.map((item) => searchResult("contact", item.id, item.name, [item.role, item.organization].filter(Boolean).join(" · ") || "Контакт", [item.phone, item.email, item.note].filter(Boolean).join(" · "), null, item.updatedAt));
  }
}

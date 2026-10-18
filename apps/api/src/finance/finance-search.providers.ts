import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { GlobalSearchResult } from "@orion/shared-types";
import { SearchProviderRegistry } from "../search/search-provider.registry";
import { type SearchProvider, searchResult } from "../search/search-provider";

/** G19: финансовый модуль отдаёт в поиск три типа — операции, счета и цели накопления; каждый регистрируется отдельно (один провайдер на тип). */
@Injectable()
export class TransactionsSearchProvider implements SearchProvider, OnModuleInit {
  readonly entityType = "transaction" as const;
  readonly componentId = "finance" as const;

  constructor(private readonly registry: SearchProviderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(tx: Prisma.TransactionClient, workspaceId: string, query: string, limit: number): Promise<GlobalSearchResult[]> {
    const rows = await tx.transaction.findMany({ where: { workspaceId, OR: [{ note: { contains: query, mode: "insensitive" } }, { tags: { has: query } }] }, include: { lines: true }, take: limit, orderBy: { updatedAt: "desc" } });
    return rows.map((item) => searchResult("transaction", item.id, item.note || "Финансовая операция", `${item.type} · ${item.lines.reduce((sum, line) => sum + line.amount, 0)}`, item.tags.join(" · "), item.projectId, item.updatedAt));
  }
}

@Injectable()
export class AccountsSearchProvider implements SearchProvider, OnModuleInit {
  readonly entityType = "account" as const;
  readonly componentId = "finance" as const;

  constructor(private readonly registry: SearchProviderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(tx: Prisma.TransactionClient, workspaceId: string, query: string, limit: number): Promise<GlobalSearchResult[]> {
    const rows = await tx.account.findMany({ where: { workspaceId, archivedAt: null, name: { contains: query, mode: "insensitive" } }, take: limit, orderBy: { updatedAt: "desc" } });
    return rows.map((item) => searchResult("account", item.id, item.name, item.currency, "", null, item.updatedAt));
  }
}

@Injectable()
export class SavingsGoalsSearchProvider implements SearchProvider, OnModuleInit {
  readonly entityType = "savings_goal" as const;
  readonly componentId = "finance" as const;

  constructor(private readonly registry: SearchProviderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(tx: Prisma.TransactionClient, workspaceId: string, query: string, limit: number): Promise<GlobalSearchResult[]> {
    // Цели накопления не имеют updatedAt в выдаче: берём дату создания и сортируем по ней (как и раньше).
    const rows = await tx.savingsGoal.findMany({ where: { workspaceId, archivedAt: null, name: { contains: query, mode: "insensitive" } }, take: limit, orderBy: { createdAt: "desc" } });
    return rows.map((item) => searchResult("savings_goal", item.id, item.name, "Цель накопления", "", null, item.createdAt));
  }
}

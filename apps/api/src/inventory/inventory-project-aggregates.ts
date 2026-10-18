import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ProjectActivity } from "@orion/shared-types";
import { countAndLatestByProject, ProjectAggregateRegistry, type ProjectAggregate, type ProjectAggregateProvider } from "../common/project-aggregates";

/** Что модуль «Склад» сообщает карточке проекта — вместо `tx.inventoryItem` внутри projects. */
@Injectable()
export class InventoryProjectAggregates implements ProjectAggregateProvider {
  readonly id = "inventory" as const;
  readonly moduleId = "inventory" as const;
  readonly order = 60;

  constructor(registry: ProjectAggregateRegistry) {
    registry.register(this);
  }

  async aggregate(tx: Prisma.TransactionClient, ids: string[]): Promise<Map<string, ProjectAggregate>> {
    const [counts, latest] = await Promise.all([
      tx.inventoryItem.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, archivedAt: null }, _count: true }),
      tx.inventoryItem.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _max: { updatedAt: true } })
    ]);
    return countAndLatestByProject(counts, latest);
  }

  async recentActivity(tx: Prisma.TransactionClient, projectId: string): Promise<ProjectActivity[]> {
    const rows = await tx.inventoryItem.findMany({
      where: { projectId, archivedAt: null },
      select: { id: true, name: true, updatedAt: true },
      take: 20,
      orderBy: { updatedAt: "desc" }
    });
    return rows.map((item) => ({ id: item.id, type: "inventory" as const, title: item.name, at: item.updatedAt.toISOString(), status: null }));
  }
}

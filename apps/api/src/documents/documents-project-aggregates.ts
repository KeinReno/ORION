import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ProjectActivity } from "@orion/shared-types";
import { countAndLatestByProject, ProjectAggregateRegistry, type ProjectAggregate, type ProjectAggregateProvider } from "../common/project-aggregates";

/** Что модуль «Документы» сообщает карточке проекта — вместо `tx.document` внутри projects. */
@Injectable()
export class DocumentsProjectAggregates implements ProjectAggregateProvider {
  readonly id = "documents" as const;
  readonly moduleId = "documents" as const;
  readonly order = 40;

  constructor(registry: ProjectAggregateRegistry) {
    registry.register(this);
  }

  async aggregate(tx: Prisma.TransactionClient, ids: string[]): Promise<Map<string, ProjectAggregate>> {
    const [counts, latest] = await Promise.all([
      tx.document.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, deletedAt: null }, _count: true }),
      tx.document.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, deletedAt: null }, _max: { updatedAt: true } })
    ]);
    return countAndLatestByProject(counts, latest);
  }

  async recentActivity(tx: Prisma.TransactionClient, projectId: string): Promise<ProjectActivity[]> {
    const rows = await tx.document.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, name: true, updatedAt: true },
      take: 20,
      orderBy: { updatedAt: "desc" }
    });
    return rows.map((item) => ({ id: item.id, type: "document" as const, title: item.name, at: item.updatedAt.toISOString(), status: null }));
  }
}

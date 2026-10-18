import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ProjectActivity } from "@orion/shared-types";
import { countAndLatestByProject, ProjectAggregateRegistry, type ProjectAggregate, type ProjectAggregateProvider } from "../common/project-aggregates";

/** Что модуль «Заметки» сообщает карточке проекта — вместо `tx.note` внутри projects. */
@Injectable()
export class NotesProjectAggregates implements ProjectAggregateProvider {
  readonly id = "notes" as const;
  readonly moduleId = "notes" as const;
  readonly order = 20;

  constructor(registry: ProjectAggregateRegistry) {
    registry.register(this);
  }

  async aggregate(tx: Prisma.TransactionClient, ids: string[]): Promise<Map<string, ProjectAggregate>> {
    const [counts, latest] = await Promise.all([
      tx.note.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, deletedAt: null }, _count: true }),
      tx.note.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, deletedAt: null }, _max: { updatedAt: true } })
    ]);
    return countAndLatestByProject(counts, latest);
  }

  async recentActivity(tx: Prisma.TransactionClient, projectId: string): Promise<ProjectActivity[]> {
    const rows = await tx.note.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, title: true, updatedAt: true },
      take: 20,
      orderBy: { updatedAt: "desc" }
    });
    return rows.map((item) => ({ id: item.id, type: "note" as const, title: item.title, at: item.updatedAt.toISOString(), status: null }));
  }
}

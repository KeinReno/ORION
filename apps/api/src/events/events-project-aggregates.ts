import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ProjectActivity } from "@orion/shared-types";
import { countAndLatestByProject, ProjectAggregateRegistry, type ProjectAggregate, type ProjectAggregateProvider } from "../common/project-aggregates";

/** Что модуль «Календарь» сообщает карточке проекта — вместо `tx.event` внутри projects. */
@Injectable()
export class EventsProjectAggregates implements ProjectAggregateProvider {
  readonly id = "events" as const;
  readonly moduleId = "calendar" as const;
  readonly order = 30;

  constructor(registry: ProjectAggregateRegistry) {
    registry.register(this);
  }

  async aggregate(tx: Prisma.TransactionClient, ids: string[]): Promise<Map<string, ProjectAggregate>> {
    const [counts, latest] = await Promise.all([
      tx.event.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _count: true }),
      tx.event.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _max: { updatedAt: true } })
    ]);
    return countAndLatestByProject(counts, latest);
  }

  async recentActivity(tx: Prisma.TransactionClient, projectId: string): Promise<ProjectActivity[]> {
    const rows = await tx.event.findMany({
      where: { projectId },
      select: { id: true, title: true, updatedAt: true },
      take: 20,
      orderBy: { updatedAt: "desc" }
    });
    return rows.map((item) => ({ id: item.id, type: "event" as const, title: item.title, at: item.updatedAt.toISOString(), status: null }));
  }
}

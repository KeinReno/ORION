import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ProjectActivity } from "@orion/shared-types";
import { ProjectAggregateRegistry, type ProjectAggregate, type ProjectAggregateProvider } from "../common/project-aggregates";

/** Что модуль «Задачи» сообщает карточке проекта (прогресс, оценка, активность) — вместо `tx.task` внутри projects. */
@Injectable()
export class TasksProjectAggregates implements ProjectAggregateProvider {
  readonly id = "tasks" as const;
  readonly moduleId = "tasks" as const;
  readonly order = 10;

  constructor(registry: ProjectAggregateRegistry) {
    registry.register(this);
  }

  async aggregate(tx: Prisma.TransactionClient, ids: string[]): Promise<Map<string, ProjectAggregate>> {
    const [statusGroups, estimated, latest] = await Promise.all([
      tx.task.groupBy({ by: ["projectId", "status"], where: { projectId: { in: ids } }, _count: true }),
      // `estimatedMinutes: { not: null }` — заодно признак «оценка есть вообще»: проект без таких строк
      // «не оценён» (null в DTO), а не «оценён в 0».
      tx.task.groupBy({
        by: ["projectId"],
        where: { projectId: { in: ids }, estimatedMinutes: { not: null } },
        _sum: { estimatedMinutes: true },
        _count: true
      }),
      tx.task.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _max: { updatedAt: true } })
    ]);
    const map = new Map<string, ProjectAggregate>();
    const entryOf = (projectId: string): ProjectAggregate => map.get(projectId) ?? map.set(projectId, {}).get(projectId)!;
    for (const entry of statusGroups) {
      if (!entry.projectId) continue;
      const aggregate = entryOf(entry.projectId);
      (aggregate.taskStatusCounts ??= []).push({ status: entry.status, count: entry._count });
    }
    for (const entry of estimated) if (entry.projectId) entryOf(entry.projectId).plannedMinutes = entry._sum.estimatedMinutes ?? 0;
    for (const entry of latest) if (entry.projectId && entry._max.updatedAt) entryOf(entry.projectId).lastActivityAt = entry._max.updatedAt;
    return map;
  }

  async recentActivity(tx: Prisma.TransactionClient, projectId: string): Promise<ProjectActivity[]> {
    const rows = await tx.task.findMany({
      where: { projectId },
      select: { id: true, title: true, status: true, updatedAt: true },
      take: 20,
      orderBy: { updatedAt: "desc" }
    });
    return rows.map((item) => ({ id: item.id, type: "task" as const, title: item.title, at: item.updatedAt.toISOString(), status: item.status }));
  }
}

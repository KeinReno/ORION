import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ProjectActivity } from "@orion/shared-types";
import { ProjectAggregateRegistry, type ProjectAggregate, type ProjectAggregateProvider } from "../common/project-aggregates";

/** Вехи в ленте активности проекта — вместо `tx.milestone` внутри projects. Вехи выключить нельзя, поэтому `moduleId` пуст. */
@Injectable()
export class MilestonesProjectAggregates implements ProjectAggregateProvider {
  readonly id = "milestones" as const;
  readonly moduleId = null;
  readonly order = 70;

  constructor(registry: ProjectAggregateRegistry) {
    registry.register(this);
  }

  /**
   * Задание 03: «веха без даты» — риск портфеля. Считает владелец вех, а не портфель:
   * projects не читает `milestones` напрямую (G4).
   */
  async aggregate(tx: Prisma.TransactionClient, ids: string[]): Promise<Map<string, ProjectAggregate>> {
    const rows = await tx.milestone.findMany({
      where: { projectId: { in: ids }, dueAt: null, status: { not: "done" } },
      select: { projectId: true, title: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }]
    });
    const map = new Map<string, ProjectAggregate>();
    for (const row of rows) {
      const entry = map.get(row.projectId) ?? map.set(row.projectId, {}).get(row.projectId)!;
      (entry.milestonesWithoutDates ??= []).push(row.title);
    }
    return map;
  }

  async recentActivity(tx: Prisma.TransactionClient, projectId: string): Promise<ProjectActivity[]> {
    const rows = await tx.milestone.findMany({
      where: { projectId },
      select: { id: true, title: true, status: true, updatedAt: true },
      take: 20,
      orderBy: { updatedAt: "desc" }
    });
    return rows.map((item) => ({ id: item.id, type: "milestone" as const, title: item.title, at: item.updatedAt.toISOString(), status: item.status }));
  }
}

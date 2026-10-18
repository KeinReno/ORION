import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { entryMinutes } from "@orion/shared-types";
import { ProjectAggregateRegistry, type ProjectAggregate, type ProjectAggregateProvider } from "../common/project-aggregates";

/** Что модуль «Время» сообщает карточке проекта (учтённые минуты) — вместо `tx.timeEntry` внутри projects. */
@Injectable()
export class TimeProjectAggregates implements ProjectAggregateProvider {
  readonly id = "time" as const;
  readonly moduleId = "time" as const;
  readonly order = 80;

  constructor(registry: ProjectAggregateRegistry) {
    registry.register(this);
  }

  async aggregate(tx: Prisma.TransactionClient, ids: string[], now: Date): Promise<Map<string, ProjectAggregate>> {
    const rows = await tx.timeEntry.findMany({
      where: { projectId: { in: ids } },
      select: { projectId: true, startedAt: true, endedAt: true }
    });
    const map = new Map<string, ProjectAggregate>();
    for (const entry of rows) {
      if (!entry.projectId) continue;
      const aggregate = map.get(entry.projectId) ?? map.set(entry.projectId, { trackedMinutes: 0 }).get(entry.projectId)!;
      aggregate.trackedMinutes =
        (aggregate.trackedMinutes ?? 0) +
        entryMinutes({ startedAt: entry.startedAt.toISOString(), endedAt: entry.endedAt?.toISOString() ?? null }, now);
    }
    return map;
  }
}

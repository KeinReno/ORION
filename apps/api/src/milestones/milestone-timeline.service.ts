import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { MilestoneTimelineReader, type MilestoneTimelineItem } from "./public/milestone-timeline";

/** Вехи проекта для Гантта; владелец таблицы — milestones, поэтому чтение здесь. */
@Injectable()
export class MilestoneTimelineQueries extends MilestoneTimelineReader {
  async byProjectTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<MilestoneTimelineItem[]> {
    const rows = await tx.milestone.findMany({
      where: { workspaceId, projectId },
      select: {
        id: true,
        title: true,
        status: true,
        startAt: true,
        dueAt: true,
        estimatedMinutes: true,
        order: true,
        dependsOn: { select: { dependsOnMilestoneId: true } }
      },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }]
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status as string,
      startAt: row.startAt,
      dueAt: row.dueAt,
      estimatedMinutes: row.estimatedMinutes,
      order: row.order,
      dependencyIds: row.dependsOn.map((dependency) => dependency.dependsOnMilestoneId)
    }));
  }

  async byIdsTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    milestoneIds: readonly string[]
  ): Promise<Array<{ id: string; title: string; dueAt: Date | null }>> {
    if (milestoneIds.length === 0) return [];
    return tx.milestone.findMany({
      where: { workspaceId, id: { in: [...milestoneIds] } },
      select: { id: true, title: true, dueAt: true }
    });
  }
}

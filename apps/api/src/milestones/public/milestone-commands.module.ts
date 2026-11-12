import { Injectable, Module } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CreateMilestoneInput } from "@orion/shared-types";
import { MilestoneCommands, type ProjectMilestoneSnapshot } from "./milestone-commands";

/**
 * Реализация публичной команды вех. Отдельный модуль без контроллеров и без
 * `MilestonesService`: модуль projects импортирует только контракт (G4), а не
 * доменный сервис соседа.
 */
@Injectable()
export class MilestoneCommandQueries extends MilestoneCommands {
  async createTx(tx: Prisma.TransactionClient, workspaceId: string, input: CreateMilestoneInput): Promise<{ id: string }> {
    const row = await tx.milestone.create({
      data: {
        workspaceId,
        projectId: input.projectId,
        title: input.title,
        note: input.note,
        status: input.status,
        startAt: input.startAt ? new Date(input.startAt) : null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        estimatedMinutes: input.estimatedMinutes ?? null,
        order: input.order
      },
      select: { id: true }
    });
    return row;
  }

  listByProjectTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<ProjectMilestoneSnapshot[]> {
    return tx.milestone.findMany({
      where: { workspaceId, projectId },
      orderBy: [{ order: "asc" }, { id: "asc" }],
      select: { id: true, title: true, note: true, status: true, startAt: true, dueAt: true, estimatedMinutes: true, order: true }
    });
  }
}

@Module({
  providers: [{ provide: MilestoneCommands, useClass: MilestoneCommandQueries }],
  exports: [MilestoneCommands]
})
export class MilestoneCommandsModule {}

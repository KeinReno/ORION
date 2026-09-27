import { Injectable, NotFoundException } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { TaskActivity } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/**
 * Read-only journal of status/assignee/due edits (S17 «журнал задач»).
 * Rows are written as a side effect of `TasksService.update` — this service
 * only ever reads.
 */
@Injectable()
export class TaskActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string, taskId: string): Promise<TaskActivity[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const task = await tx.task.findUnique({ where: { id: taskId } });
      if (!task || task.workspaceId !== workspaceId) throw new NotFoundException("Задача не найдена");
      const rows = await tx.taskActivity.findMany({
        where: { workspaceId, taskId },
        include: { actor: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: "desc" }],
        take: 200
      });
      return rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        taskId: row.taskId,
        actorId: row.actorId,
        actorName: (row.actor as Pick<User, "id" | "name"> | null)?.name ?? null,
        field: row.field as TaskActivity["field"],
        fromValue: row.fromValue,
        toValue: row.toValue,
        createdAt: row.createdAt.toISOString()
      }));
    });
  }
}

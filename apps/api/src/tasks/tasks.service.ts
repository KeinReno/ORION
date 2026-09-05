import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CreateTaskInput, Task, UpdateTaskInput } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string): Promise<Task[]> {
    const tasks = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.task.findMany({
        where: { workspaceId },
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }]
      });
    });
    return tasks.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateTaskInput): Promise<Task> {
    const task = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.task.create({
        data: {
          workspaceId,
          title: input.title,
          description: input.description,
          dueAt: input.dueAt ?? null,
          projectTag: input.projectTag ?? null
        }
      });
    });
    return toDto(task);
  }

  async update(userId: string, workspaceId: string, taskId: string, input: UpdateTaskInput): Promise<Task> {
    const task = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, taskId);
      const data: Prisma.TaskUpdateInput = { ...input };
      if (input.dueAt !== undefined) {
        // Re-arm the reminder whenever the due date changes — otherwise a
        // task that was already notified once could never be notified again.
        data.notifiedAt = null;
      }
      return tx.task.update({ where: { id: taskId }, data });
    });
    return toDto(task);
  }

  async remove(userId: string, workspaceId: string, taskId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, taskId);
      await tx.task.delete({ where: { id: taskId } });
    });
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, taskId: string): Promise<void> {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task || task.workspaceId !== workspaceId) {
      throw new NotFoundException("Задача не найдена");
    }
  }
}

function toDto(task: {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  status: string;
  dueAt: Date | null;
  projectTag: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Task {
  return {
    id: task.id,
    workspaceId: task.workspaceId,
    title: task.title,
    description: task.description,
    status: task.status as Task["status"],
    dueAt: task.dueAt ? task.dueAt.toISOString() : null,
    projectTag: task.projectTag,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString()
  };
}

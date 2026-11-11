import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { TaskTraceReader, type TaskReferenceLookup, type TaskTraceSource } from "./public/task-trace-reader";

/** Реализация публичного среза задачи для таймлайна (задание 11.2). Живёт у владельца данных — tasks. */
@Injectable()
export class TaskTraceQueries extends TaskTraceReader {
  async traceSourceTx(tx: Prisma.TransactionClient, workspaceId: string, taskId: string): Promise<TaskTraceSource | null> {
    const task = await tx.task.findFirst({
      where: { id: taskId, workspaceId },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        completedAt: true,
        assignee: { select: { user: { select: { name: true } } } }
      }
    });
    if (!task) return null;
    const activities = await tx.taskActivity.findMany({
      where: { workspaceId, taskId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        field: true,
        fromValue: true,
        toValue: true,
        createdAt: true,
        agentName: true,
        actor: { select: { name: true } }
      }
    });
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      assigneeName: task.assignee?.user?.name ?? null,
      activities: activities.map((activity) => ({
        id: activity.id,
        field: activity.field,
        fromValue: activity.fromValue,
        toValue: activity.toValue,
        createdAt: activity.createdAt,
        agentName: activity.agentName,
        actorName: activity.actor?.name ?? null
      }))
    };
  }

  /**
   * Ссылка на задачу: номер — это N-я задача пространства по (createdAt, id), префикс — начало id.
   * Оба варианта ищут только внутри `workspaceId`; никакой глобальной нумерации нет.
   */
  async resolveReferenceTx(tx: Prisma.TransactionClient, workspaceId: string, lookup: TaskReferenceLookup): Promise<string | null> {
    if ("ordinal" in lookup) {
      if (!Number.isInteger(lookup.ordinal) || lookup.ordinal < 1) return null;
      const row = await tx.task.findMany({
        where: { workspaceId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: lookup.ordinal - 1,
        take: 1,
        select: { id: true }
      });
      return row[0]?.id ?? null;
    }
    const exact = await tx.task.findFirst({ where: { workspaceId, id: lookup.idPrefix }, select: { id: true } });
    if (exact) return exact.id;
    const prefixed = await tx.task.findFirst({ where: { workspaceId, id: { startsWith: lookup.idPrefix } }, select: { id: true } });
    return prefixed?.id ?? null;
  }
}

import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isTaskClosed, taskChecklistItemSchema, type MyOverview, type TaskChecklistItem } from "@orion/shared-types";
import { TaskOverviewReader, type OverviewTask } from "./public/task-overview-reader";

@Injectable()
export class TaskOverviewQueries extends TaskOverviewReader {
  async assignedTx(tx: Prisma.TransactionClient, workspaceId: string, assigneeId: string): Promise<OverviewTask[]> {
    const rows = await tx.task.findMany({
      where: { workspaceId, assigneeId },
      include: { dependsOn: { include: { dependsOn: { select: { status: true } } } } },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }]
    });
    return rows.filter(task => !isTaskClosed(task.status)).map(task => ({
      id: task.id,
      revision: task.revision,
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      parentId: task.parentId,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueAt: task.dueAt?.toISOString() ?? null,
      projectTag: task.projectTag,
      recurrence: task.recurrence as MyOverview["tasks"][number]["recurrence"],
      completedAt: task.completedAt?.toISOString() ?? null,
      sortOrder: task.sortOrder,
      dependencyIds: task.dependsOn.map((d) => d.dependsOnTaskId),
      blocked: task.dependsOn.some((d) => !isTaskClosed(d.dependsOn.status)),
      assigneeId: task.assigneeId,
      startAt: task.startAt?.toISOString() ?? null,
      estimatedMinutes: task.estimatedMinutes,
      milestoneId: task.milestoneId,
      checklist: readChecklist(task.checklist),
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString()
    }));
  }
}

function readChecklist(value: Prisma.JsonValue): TaskChecklistItem[] {
  if (!Array.isArray(value)) return [];
  const items: TaskChecklistItem[] = [];
  for (const item of value) {
    const parsed = taskChecklistItemSchema.safeParse(item);
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}

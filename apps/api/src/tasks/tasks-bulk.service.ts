import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  emptyBulkTaskEffects,
  isTaskClosed,
  type BulkTaskEffects,
  type BulkTaskItemReason,
  type BulkTaskItemResult,
  type BulkTaskOperation,
  type BulkTaskRequest,
  type BulkTaskResult,
  type TaskStatus
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { DomainEventBus } from "../domain-events/domain-event-bus";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ProjectTaskLinks } from "../projects/public/project-task-links";
import { PublishedSources } from "../shared/public/published-source";
import { TasksService } from "./tasks.service";
import { TaskStatusesService } from "./task-statuses.service";

/**
 * Массовые операции над задачами (задание 02, 2.2).
 *
 * Правила, которые нельзя размывать:
 * - `dryRun` (и отсутствие `confirm: true`) — только предварительный ответ,
 *   ни одной записи.
 * - Частичное применение запрещено без `allowPartial`: если хотя бы одна
 *   позиция отклонена, транзакция не начинается вовсе — 409 с причинами.
 * - Причины отказа считаются по каждой задаче отдельно (нет доступа/нет в
 *   пространстве, активная публикация, заблокирована зависимостями).
 * - На каждую изменённую задачу идут её обычные события (`task.changed`,
 *   `status_changed`), плюс одно сводное `task.bulk_applied`.
 */
@Injectable()
export class TasksBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly tasks: TasksService,
    private readonly statuses: TaskStatusesService,
    private readonly projectLinks: ProjectTaskLinks,
    private readonly published: PublishedSources,
    private readonly events: DomainEventBus
  ) {}

  async run(userId: string, workspaceId: string, input: BulkTaskRequest): Promise<BulkTaskResult> {
    const taskIds = [...new Set(input.taskIds)];
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      validateOperation(input.operation);
      // Общие проверки операции — до перебора: невалидный статус/проект это
      // ошибка запроса (400), а не «эта задача не подходит».
      const targetStatus = await this.resolveStatusTx(tx, workspaceId, input.operation);
      const statusId = targetStatus?.id ?? null;
      if (input.operation.type === "move-to-project" && input.operation.projectId) {
        const project = await this.projectLinks.byIdTx(tx, workspaceId, input.operation.projectId);
        if (!project) throw new BadRequestException("Проект не найден");
      }

      const rows = await tx.task.findMany({
        where: { workspaceId, id: { in: taskIds } },
        include: { dependsOn: { include: { dependsOn: { select: { status: true } } } } }
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const publishedMap = await this.published.activeBySourceTx(tx, {
        sourceWorkspaceId: workspaceId,
        kind: "task",
        sourceIds: taskIds
      });
      const roles = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { role: true }
      });
      const privileged = roles?.role === "owner" || roles?.role === "lead";

      const items: BulkTaskItemResult[] = [];
      const applicable: string[] = [];
      for (const id of taskIds) {
        const task = byId.get(id);
        if (!task) {
          items.push(item(id, false, "not_found", "Задача не найдена в пространстве"));
          continue;
        }
        const blocked = task.dependsOn.some((dependency) => !isTaskClosed(dependency.dependsOn.status));
        const publication = publishedMap.get(id);
        const verdict = eligibility(
          input.operation,
          { task, blocked, publication, userId, privileged },
          targetStatus?.category ?? null
        );
        items.push(item(id, verdict.ok, verdict.reason, verdict.message));
        if (verdict.ok) applicable.push(id);
      }

      const effects = effectsFor(input.operation, applicable, byId, statusId);
      const summary = {
        requested: taskIds.length,
        ok: items.filter((entry) => entry.ok).length,
        failed: items.filter((entry) => !entry.ok).length
      };
      const shouldApply = input.confirm && !input.dryRun;
      if (!shouldApply) {
        return { dryRun: true, applied: false, items, summary, effects };
      }
      if (summary.failed > 0 && !input.allowPartial) {
        throw new ConflictException({
          code: "bulk_partial_not_allowed",
          message: "Часть задач нельзя изменить — подтвердите частичное применение (allowPartial) или измените выбор",
          items,
          summary
        });
      }

      for (const id of applicable) {
        await this.applyOneTx(tx, userId, workspaceId, id, input.operation, statusId);
      }
      await this.events.publishTx(tx, {
        workspaceId,
        actorId: userId,
        type: "tasks.task.bulk_applied",
        payload: {
          operation: input.operation.type,
          taskIds: applicable,
          applied: applicable.length,
          failed: summary.failed,
          allowPartial: input.allowPartial
        }
      });
      return { dryRun: false, applied: true, items, summary, effects };
    });
  }

  private async applyOneTx(
    tx: Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
    taskId: string,
    operation: BulkTaskOperation,
    statusId: string | null
  ): Promise<void> {
    switch (operation.type) {
      case "complete":
        await this.tasks.updateTx(tx, userId, workspaceId, taskId, { status: "done" });
        return;
      case "set-status":
        if (statusId) await this.tasks.updateTx(tx, userId, workspaceId, taskId, { statusId });
        else await this.tasks.updateTx(tx, userId, workspaceId, taskId, { status: operation.status! });
        return;
      case "set-priority":
        await this.tasks.updateTx(tx, userId, workspaceId, taskId, { priority: operation.priority });
        return;
      case "move-to-project":
        await this.tasks.updateTx(tx, userId, workspaceId, taskId, { projectId: operation.projectId });
        return;
      case "archive":
        await this.tasks.updateTx(tx, userId, workspaceId, taskId, { archived: operation.archived });
        return;
      case "change-dates":
        await this.tasks.updateTx(tx, userId, workspaceId, taskId, {
          ...(operation.dueAt !== undefined ? { dueAt: operation.dueAt } : {}),
          ...(operation.startAt !== undefined ? { startAt: operation.startAt } : {})
        });
        return;
      case "delete":
        await tx.task.delete({ where: { id: taskId } });
        await this.events.publishTx(tx, { workspaceId, actorId: userId, type: "tasks.task.changed", payload: { id: taskId } });
        return;
    }
  }

  private async resolveStatusTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    operation: BulkTaskOperation
  ): Promise<{ id: string; category: string } | null> {
    if (operation.type !== "set-status") return null;
    if (operation.statusId) {
      const status = await this.statuses.requireTx(tx, workspaceId, operation.statusId);
      return { id: status.id, category: status.category };
    }
    if (operation.status) {
      const status = await this.statuses.bySystemKeyTx(tx, workspaceId, operation.status);
      return status ? { id: status.id, category: status.category } : null;
    }
    return null;
  }
}

function validateOperation(operation: BulkTaskOperation): void {
  if (operation.type === "set-status" && !operation.status && !operation.statusId) {
    throw new BadRequestException("Укажите status или statusId");
  }
  if (operation.type === "change-dates" && operation.dueAt === undefined && operation.startAt === undefined) {
    throw new BadRequestException("Укажите dueAt или startAt");
  }
}

interface Verdict {
  ok: boolean;
  reason: BulkTaskItemReason | null;
  message: string | null;
}

function eligibility(
  operation: BulkTaskOperation,
  context: {
    task: {
      id: string;
      status: TaskStatus;
      archivedAt: Date | null;
      projectId: string | null;
      priority: string;
      dueAt: Date | null;
      startAt: Date | null;
    };
    blocked: boolean;
    publication: { publisherId: string } | undefined;
    userId: string;
    privileged: boolean;
  },
  statusCategory: string | null
): Verdict {
  const { task, blocked, publication, userId, privileged } = context;
  const isDone = isTaskClosed(task.status);
  if (operation.type === "delete" || operation.type === "archive") {
    if (publication) {
      if (publication.publisherId !== userId && !privileged) {
        return { ok: false, reason: "no_permission", message: "Публикацию задачи создал другой участник" };
      }
      return { ok: false, reason: "in_publication", message: "Задача в активной публикации — сначала отзовите её" };
    }
    return { ok: true, reason: null, message: null };
  }
  if (task.archivedAt) {
    return { ok: false, reason: "archived", message: "Задача в архиве" };
  }
  if (operation.type === "complete" && isDone) {
    return { ok: true, reason: null, message: null };
  }
  if (operation.type === "complete" && blocked) {
    return { ok: false, reason: "blocked", message: "Задача заблокирована незавершёнными зависимостями" };
  }
  if (operation.type === "set-status") {
    // Блокировка важна только для перехода в закрытую категорию.
    const closes =
      statusCategory === "done" ||
      statusCategory === "cancelled" ||
      operation.status === "done" ||
      operation.status === "canceled";
    if (blocked && closes) {
      return { ok: false, reason: "blocked", message: "Задача заблокирована незавершёнными зависимостями" };
    }
  }
  if (operation.type === "change-dates" && task.status === "canceled") {
    return { ok: false, reason: "invalid", message: "Отменённую задачу не перепланируем" };
  }
  return { ok: true, reason: null, message: null };
}

function effectsFor(
  operation: BulkTaskOperation,
  applicable: readonly string[],
  byId: Map<string, { status: TaskStatus; archivedAt: Date | null; projectId: string | null; priority: string; dueAt: Date | null; startAt: Date | null }>,
  statusId: string | null
): BulkTaskEffects {
  const effects = emptyBulkTaskEffects();
  switch (operation.type) {
    case "complete":
      effects.completed = applicable.filter((id) => !isTaskClosed(byId.get(id)!.status)).length;
      break;
    case "set-status":
      effects.statusChanged = applicable.filter((id) => {
        const task = byId.get(id)!;
        if (statusId) return true;
        return operation.status !== undefined && task.status !== operation.status;
      }).length;
      break;
    case "set-priority":
      effects.priorityChanged = applicable.filter((id) => byId.get(id)!.priority !== operation.priority).length;
      break;
    case "move-to-project":
      effects.moved = applicable.filter((id) => byId.get(id)!.projectId !== operation.projectId).length;
      break;
    case "delete":
      effects.deleted = applicable.length;
      break;
    case "archive":
      effects.archived = applicable.filter((id) => (byId.get(id)!.archivedAt !== null) !== operation.archived).length;
      break;
    case "change-dates":
      effects.datesChanged = applicable.filter((id) => {
        const task = byId.get(id)!;
        const dueChanged = operation.dueAt !== undefined && (task.dueAt?.toISOString() ?? null) !== operation.dueAt;
        const startChanged = operation.startAt !== undefined && (task.startAt?.toISOString() ?? null) !== operation.startAt;
        return dueChanged || startChanged;
      }).length;
      break;
  }
  return effects;
}

function item(taskId: string, ok: boolean, reason: BulkTaskItemReason | null, message: string | null): BulkTaskItemResult {
  return { taskId, ok, reason, message };
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  type CreateTaskStatusInput,
  type TaskStatus,
  type TaskStatusCategory,
  type TaskStatusDefinition,
  type UpdateTaskStatusInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { DomainEventBus } from "../domain-events/domain-event-bus";
import { WorkspacesService } from "../workspaces/workspaces.service";

/**
 * Пользовательские статусы пространства (задание 02, 2.3).
 *
 * `Task.status` (enum) остаётся категорией: `done`/`canceled` — закрытые,
 * остальные открыты. Пользовательский статус — это имя/цвет/порядок поверх
 * категории, поэтому `isTaskClosed`, отчёты и напоминания не переписываются.
 * Дефолтный набор создаётся миграцией для существующих пространств и лениво
 * (`ensureDefaultsTx`) для новых — заводить статусы в AuthService нельзя:
 * регистрация живёт в ядре и не должна знать про задачи.
 */

export interface StatusDefaults {
  systemKey: string;
  name: string;
  category: TaskStatusCategory;
  color: string;
  isDefault: boolean;
  sortOrder: number;
}

export const DEFAULT_TASK_STATUSES: readonly StatusDefaults[] = [
  { systemKey: "backlog", name: "Бэклог", category: "open", color: "slate", isDefault: false, sortOrder: 0 },
  { systemKey: "todo", name: "К выполнению", category: "open", color: "sky", isDefault: true, sortOrder: 10 },
  { systemKey: "in_progress", name: "В работе", category: "in_progress", color: "amber", isDefault: false, sortOrder: 20 },
  { systemKey: "done", name: "Готово", category: "done", color: "emerald", isDefault: false, sortOrder: 30 },
  { systemKey: "canceled", name: "Отменено", category: "cancelled", color: "rose", isDefault: false, sortOrder: 40 }
];

/** Категория → прежний enum `TaskStatus`: по нему считают закрытость и отчёты. */
export function legacyStatusForCategory(category: TaskStatusCategory): TaskStatus {
  switch (category) {
    case "open":
      return "todo";
    case "in_progress":
      return "in_progress";
    case "done":
      return "done";
    case "cancelled":
      return "canceled";
  }
}

@Injectable()
export class TaskStatusesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly events: DomainEventBus
  ) {}

  async list(userId: string, workspaceId: string): Promise<TaskStatusDefinition[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.ensureDefaultsTx(tx, workspaceId);
      const rows = await tx.taskStatusDefinition.findMany({
        where: { workspaceId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      });
      return rows.map(toStatusDto);
    });
  }

  async create(userId: string, workspaceId: string, input: CreateTaskStatusInput): Promise<TaskStatusDefinition> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.ensureDefaultsTx(tx, workspaceId);
      const duplicate = await tx.taskStatusDefinition.findFirst({
        where: { workspaceId, name: { equals: input.name, mode: "insensitive" } }
      });
      if (duplicate) throw new ConflictException("Статус с таким названием уже существует");
      if (input.isDefault) {
        await tx.taskStatusDefinition.updateMany({ where: { workspaceId, isDefault: true }, data: { isDefault: false } });
      }
      const sortOrder = input.sortOrder ?? (await nextSortOrderTx(tx, workspaceId));
      return tx.taskStatusDefinition.create({
        data: {
          workspaceId,
          name: input.name,
          category: input.category,
          color: input.color,
          isDefault: input.isDefault ?? false,
          sortOrder
        }
      });
    });
    return toStatusDto(row);
  }

  async update(userId: string, workspaceId: string, statusId: string, input: UpdateTaskStatusInput): Promise<TaskStatusDefinition> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const current = await this.requireTx(tx, workspaceId, statusId);
      if (input.name !== undefined && input.name !== current.name) {
        const duplicate = await tx.taskStatusDefinition.findFirst({
          where: { workspaceId, name: { equals: input.name, mode: "insensitive" }, id: { not: statusId } }
        });
        if (duplicate) throw new ConflictException("Статус с таким названием уже существует");
      }
      if (input.isDefault === true) {
        await tx.taskStatusDefinition.updateMany({ where: { workspaceId, isDefault: true, id: { not: statusId } }, data: { isDefault: false } });
      }
      const updated = await tx.taskStatusDefinition.update({
        where: { id: statusId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {})
        }
      });
      // Смена категории меняет семантику для всех задач на этом статусе:
      // держим enum `Task.status` в согласии с категорией.
      if (input.category !== undefined && input.category !== current.category) {
        const tasks = await tx.task.findMany({ where: { workspaceId, statusId }, select: { id: true, status: true } });
        const legacy = legacyStatusForCategory(input.category);
        await tx.task.updateMany({ where: { workspaceId, statusId }, data: { status: legacy, completedAt: legacy === "done" ? new Date() : null } });
        for (const task of tasks) {
          if (task.status === legacy) continue;
          await this.events.publishTx(tx, {
            workspaceId,
            actorId: userId,
            type: "tasks.task.status_changed",
            payload: { id: task.id, fromStatus: task.status, toStatus: legacy, statusId }
          });
        }
      }
      return updated;
    });
    return toStatusDto(row);
  }

  /**
   * Удаление статуса. Занятый статус требует явного `confirm`: без него —
   * 409 с числом задач и статусом переноса, чтобы клиент показал подтверждение.
   */
  async remove(
    userId: string,
    workspaceId: string,
    statusId: string,
    options: { confirm?: boolean; reassignToId?: string } = {}
  ): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const current = await this.requireTx(tx, workspaceId, statusId);
      if (current.isDefault) {
        throw new BadRequestException("Нельзя удалить статус по умолчанию — сначала назначьте другой");
      }
      const taskCount = await tx.task.count({ where: { workspaceId, statusId } });
      if (taskCount > 0) {
        const fallback = await this.defaultStatusTx(tx, workspaceId);
        const targetId = options.reassignToId ?? fallback?.id;
        if (!targetId || targetId === statusId) {
          throw new BadRequestException("Назначьте статус, в который перенести задачи");
        }
        const target = await this.requireTx(tx, workspaceId, targetId);
        if (!options.confirm) {
          throw new ConflictException({
            code: "task_status_in_use",
            message: `На статусе «${current.name}» ${taskCount} задач — подтвердите перенос в «${target.name}»`,
            statusId,
            taskCount,
            reassignToId: target.id
          });
        }
        const tasks = await tx.task.findMany({ where: { workspaceId, statusId }, select: { id: true, status: true } });
        const legacy = legacyStatusForCategory(target.category);
        await tx.task.updateMany({
          where: { workspaceId, statusId },
          data: { statusId: target.id, status: legacy, completedAt: legacy === "done" ? new Date() : null }
        });
        for (const task of tasks) {
          if (task.status === legacy) continue;
          await this.events.publishTx(tx, {
            workspaceId,
            actorId: userId,
            type: "tasks.task.status_changed",
            payload: { id: task.id, fromStatus: task.status, toStatus: legacy, statusId: target.id }
          });
        }
      }
      await tx.taskStatusDefinition.delete({ where: { id: statusId } });
    });
  }

  async requireTx(tx: Prisma.TransactionClient, workspaceId: string, statusId: string) {
    const status = await tx.taskStatusDefinition.findFirst({ where: { id: statusId, workspaceId } });
    if (!status) throw new NotFoundException("Статус не найден");
    return status;
  }

  async defaultStatusTx(tx: Prisma.TransactionClient, workspaceId: string) {
    return (
      (await tx.taskStatusDefinition.findFirst({ where: { workspaceId, isDefault: true } })) ??
      (await tx.taskStatusDefinition.findFirst({ where: { workspaceId, systemKey: "todo" } })) ??
      (await tx.taskStatusDefinition.findFirst({ where: { workspaceId }, orderBy: { sortOrder: "asc" } }))
    );
  }

  /** Статус для прежнего enum-значения (`todo`, `done`, …) — синхронизация старого API. */
  async bySystemKeyTx(tx: Prisma.TransactionClient, workspaceId: string, systemKey: string) {
    await this.ensureDefaultsTx(tx, workspaceId);
    return tx.taskStatusDefinition.findFirst({ where: { workspaceId, systemKey } });
  }

  /**
   * Идемпотентно создаёт недостающие встроенные статусы. `createMany(...,
   * skipDuplicates)` — гонка двух первых запросов нового пространства не
   * плодит дубли (уникальный индекс `(workspaceId, systemKey)`).
   */
  async ensureDefaultsTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
    const existing = await tx.taskStatusDefinition.count({ where: { workspaceId } });
    if (existing >= DEFAULT_TASK_STATUSES.length) return;
    const present = await tx.taskStatusDefinition.findMany({ where: { workspaceId }, select: { systemKey: true } });
    const presentKeys = new Set(present.map((row) => row.systemKey));
    const missing = DEFAULT_TASK_STATUSES.filter((status) => !presentKeys.has(status.systemKey));
    if (!missing.length) return;
    await tx.taskStatusDefinition.createMany({
      data: missing.map((status) => ({
        workspaceId,
        name: status.name,
        category: status.category,
        color: status.color,
        isDefault: status.isDefault,
        sortOrder: status.sortOrder,
        systemKey: status.systemKey
      })),
      skipDuplicates: true
    });
  }
}

async function nextSortOrderTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<number> {
  const last = await tx.taskStatusDefinition.findFirst({
    where: { workspaceId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true }
  });
  return (last?.sortOrder ?? 0) + 10;
}

export function toStatusDto(row: {
  id: string;
  workspaceId: string;
  name: string;
  category: string;
  color: string;
  isDefault: boolean;
  sortOrder: number;
  systemKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}): TaskStatusDefinition {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    category: row.category as TaskStatusCategory,
    color: row.color,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
    systemKey: row.systemKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

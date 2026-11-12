import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  advanceTaskRecurrence,
  taskRecurrenceEndReached,
  type SetTaskRecurrenceInput,
  type TaskRecurrence as LegacyTaskRecurrence,
  type TaskRecurrenceEnd,
  type TaskRecurrenceFrequency,
  type TaskRecurrenceInstance,
  type TaskRecurrenceRule
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { DomainEventBus } from "../domain-events/domain-event-bus";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { TaskStatusesService } from "./task-statuses.service";

/**
 * Рекуррентные задачи (задание 02, 2.1).
 *
 * Материализация — ровно один следующий экземпляр при завершении текущего.
 * Идемпотентность держится двумя ключами БД, а не проверкой в сервисе:
 * `TaskRecurrenceInstance.ordinal` уникален внутри правила, а условный
 * `UPDATE ... WHERE generatedCount = <прочитано>` пропускает только одного
 * победителя гонки. Пропущенные периоды ретроспективно не генерируются.
 *
 * Перенос даты конкретного экземпляра цепочку не ломает: следующая дата
 * считается от фактической `dueAt` завершённого, а сетка «каждые N недель» —
 * от `anchorAt` правила. Отмена (skip) сохраняет историю: экземпляр помечается
 * `skipped`, задача удаляется, `taskId` становится null.
 */

export interface MaterializeResult {
  /** true — задачей владеет правило (даже если следующий экземпляр не нужен). */
  handled: boolean;
  nextTaskId: string | null;
}

@Injectable()
export class TaskRecurrenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly statuses: TaskStatusesService,
    private readonly events: DomainEventBus
  ) {}

  async get(userId: string, workspaceId: string, taskId: string): Promise<TaskRecurrenceRule | null> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertTaskTx(tx, workspaceId, taskId);
      return tx.taskRecurrence.findFirst({
        where: { workspaceId, OR: [{ templateId: taskId }, { instances: { some: { taskId } } }] },
        include: { instances: { orderBy: { ordinal: "asc" } } }
      });
    });
    return row ? toRuleDto(row) : null;
  }

  async set(userId: string, workspaceId: string, taskId: string, input: SetTaskRecurrenceInput): Promise<TaskRecurrenceRule> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const task = await this.assertTaskTx(tx, workspaceId, taskId);
      if (input.freq === "weekly" && input.weekdays && input.weekdays.length > 0) {
        // validate only; weekly может нести явный список дней
      }
      await this.upsertRuleTx(tx, workspaceId, task, {
        freq: input.freq,
        interval: input.interval,
        weekdays: input.weekdays ?? [],
        ends: input.ends
      });
      return tx.taskRecurrence.findUniqueOrThrow({
        where: { templateId: taskId },
        include: { instances: { orderBy: { ordinal: "asc" } } }
      });
    });
    return toRuleDto(row);
  }

  async remove(userId: string, workspaceId: string, taskId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertTaskTx(tx, workspaceId, taskId);
      await detachRuleTx(tx, workspaceId, taskId);
    });
  }

  /**
   * Отмена отдельного будущего экземпляра: помечаем skipped, при необходимости
   * создаём следующий и удаляем отменённую задачу. Цепочка продолжается.
   */
  async skip(userId: string, workspaceId: string, taskId: string): Promise<{ nextTaskId: string | null }> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const task = await this.assertTaskTx(tx, workspaceId, taskId);
      const instance = await tx.taskRecurrenceInstance.findFirst({
        where: { workspaceId, taskId },
        include: { recurrence: true }
      });
      if (!instance) throw new NotFoundException("У задачи нет правила повторения");
      if (instance.recurrence.templateId === taskId) {
        throw new BadRequestException("Шаблон цепочки нельзя пропустить — настройте правило или завершите задачу");
      }
      if (instance.status !== "scheduled") {
        throw new ConflictException("Этот экземпляр уже завершён или пропущен");
      }
      const rule = instance.recurrence;
      await tx.taskRecurrenceInstance.update({ where: { id: instance.id }, data: { status: "skipped" } });

      const nextDue = advanceTaskRecurrence(instance.scheduledFor, ruleSpec(rule), rule.anchorAt);
      let nextTaskId: string | null = null;
      if (!taskRecurrenceEndReached(endsOf(rule), rule.generatedCount, nextDue)) {
        const guard = await tx.taskRecurrence.updateMany({
          where: { id: rule.id, generatedCount: rule.generatedCount },
          data: { generatedCount: { increment: 1 } }
        });
        if (guard.count > 0) {
          const next = await this.createNextTaskTx(tx, task, rule, nextDue, rule.generatedCount + 1);
          nextTaskId = next.id;
        }
      }

      await this.events.publishTx(tx, {
        workspaceId,
        actorId: userId,
        type: "tasks.recurrence.skipped",
        payload: { ruleId: rule.id, taskId, nextTaskId, scheduledFor: instance.scheduledFor.toISOString() }
      });
      // Удаление задачи оставляет пропущенный экземпляр в истории (taskId → null).
      await tx.task.delete({ where: { id: taskId } });
      await this.events.publishTx(tx, { workspaceId, actorId: userId, type: "tasks.task.changed", payload: { id: taskId } });
      return { nextTaskId };
    });
  }

  /**
   * Вызывается из `TasksService.updateTx` в той же транзакции, что и смена
   * статуса. Возвращает `handled: false`, если правило не найдено — тогда
   * работает прежняя (legacy) ветка `Task.recurrence`.
   */
  async materializeOnCompletionTx(
    tx: Prisma.TransactionClient,
    params: { userId: string; workspaceId: string; taskId: string }
  ): Promise<MaterializeResult> {
    const instance = await tx.taskRecurrenceInstance.findFirst({
      where: { workspaceId: params.workspaceId, taskId: params.taskId },
      include: { recurrence: true }
    });
    if (!instance) return { handled: false, nextTaskId: null };
    if (instance.status === "completed") return { handled: true, nextTaskId: null };
    const task = await tx.task.findUniqueOrThrow({ where: { id: params.taskId } });
    await tx.taskRecurrenceInstance.update({ where: { id: instance.id }, data: { status: "completed" } });

    const rule = instance.recurrence;
    const nextDue = advanceTaskRecurrence(task.dueAt ?? instance.scheduledFor, ruleSpec(rule), rule.anchorAt);
    if (taskRecurrenceEndReached(endsOf(rule), rule.generatedCount, nextDue)) {
      return { handled: true, nextTaskId: null };
    }
    // Только один победитель гонки двух завершений увеличит счётчик.
    const guard = await tx.taskRecurrence.updateMany({
      where: { id: rule.id, generatedCount: rule.generatedCount },
      data: { generatedCount: { increment: 1 } }
    });
    if (guard.count === 0) return { handled: true, nextTaskId: null };

    const next = await this.createNextTaskTx(tx, task, rule, nextDue, rule.generatedCount + 1);
    await this.events.publishTx(tx, {
      workspaceId: params.workspaceId,
      actorId: params.userId,
      type: "tasks.recurrence.instance_completed",
      payload: { ruleId: rule.id, previousTaskId: params.taskId, nextTaskId: next.id, ordinal: rule.generatedCount + 1 }
    });
    return { handled: true, nextTaskId: next.id };
  }

  /**
   * Синхронизация со старым полем `Task.recurrence` (JSON). Старый клиент,
   * присылающий daily/weekly/monthly + interval, продолжает работать: сервер
   * создаёт по нему правило, и материализация идёт уже через него.
   */
  async syncLegacyTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    taskId: string,
    recurrence: LegacyTaskRecurrence | null
  ): Promise<void> {
    const task = await tx.task.findFirst({ where: { id: taskId, workspaceId } });
    if (!task) return;
    if (!recurrence || !["daily", "weekly", "monthly"].includes(recurrence.freq)) {
      // yearly/legacy-без-правила остаётся на прежней ветке; удаляем только
      // собственное правило шаблона, чужие цепочки не трогаем.
      await detachRuleTx(tx, workspaceId, taskId);
      return;
    }
    await this.upsertRuleTx(tx, workspaceId, task, {
      freq: recurrence.freq as TaskRecurrenceFrequency,
      interval: recurrence.interval,
      weekdays: [],
      ends: { mode: "never" }
    });
  }

  private async upsertRuleTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    task: { id: string; dueAt: Date | null },
    spec: { freq: TaskRecurrenceFrequency; interval: number; weekdays: number[]; ends: TaskRecurrenceEnd }
  ): Promise<void> {
    const endsMode = spec.ends.mode;
    const endsCount = spec.ends.mode === "count" ? spec.ends.count : null;
    const endsAt = spec.ends.mode === "until" ? new Date(spec.ends.until) : null;
    const weekdays = [...new Set(spec.weekdays)].filter((day) => day >= 0 && day <= 6).sort((a, b) => a - b);
    const existing = await tx.taskRecurrence.findUnique({ where: { templateId: task.id } });
    const anchorAt = existing?.anchorAt ?? task.dueAt ?? new Date();
    const rule = await tx.taskRecurrence.upsert({
      where: { templateId: task.id },
      create: {
        workspaceId,
        templateId: task.id,
        freq: spec.freq,
        interval: spec.interval,
        weekdays,
        endsMode,
        endsCount,
        endsAt,
        generatedCount: 1,
        anchorAt
      },
      update: {
        freq: spec.freq,
        interval: spec.interval,
        weekdays,
        endsMode,
        endsCount,
        endsAt
      }
    });

    const legacy = legacyJson(spec);
    await tx.task.update({
      where: { id: task.id },
      data: { recurrence: legacy ? (legacy as unknown as Prisma.InputJsonValue) : Prisma.DbNull }
    });

    // Шаблон — первый экземпляр цепочки (ordinal 1).
    const instance = await tx.taskRecurrenceInstance.findUnique({ where: { taskId: task.id } });
    if (!instance) {
      await tx.taskRecurrenceInstance.create({
        data: {
          workspaceId,
          recurrenceId: rule.id,
          taskId: task.id,
          ordinal: 1,
          scheduledFor: anchorAt,
          status: "scheduled"
        }
      });
    }
  }

  private async createNextTaskTx(
    tx: Prisma.TransactionClient,
    current: {
      id: string;
      workspaceId: string;
      projectId: string | null;
      projectTag: string | null;
      parentId: string | null;
      title: string;
      description: string;
      priority: string;
      sortOrder: number;
      assigneeId: string | null;
      estimatedMinutes: number | null;
      milestoneId: string | null;
      homeId: string | null;
      importance: number | null;
      urgency: number | null;
      complexity: string | null;
      checklist: Prisma.JsonValue;
    },
    rule: { id: string; workspaceId: string; endsMode: string; endsCount: number | null; endsAt: Date | null; anchorAt: Date; freq: string; interval: number; weekdays: number[] },
    nextDue: Date,
    ordinal: number
  ) {
    const openStatus = await this.statuses.bySystemKeyTx(tx, current.workspaceId, "todo");
    const next = await tx.task.create({
      data: {
        workspaceId: current.workspaceId,
        projectId: current.projectId,
        projectTag: current.projectTag,
        parentId: current.parentId,
        title: current.title,
        description: current.description,
        priority: current.priority as Prisma.TaskCreateInput["priority"],
        status: "todo",
        statusId: openStatus?.id ?? null,
        dueAt: nextDue,
        sortOrder: current.sortOrder,
        assigneeId: current.assigneeId,
        estimatedMinutes: current.estimatedMinutes,
        milestoneId: current.milestoneId,
        homeId: current.homeId,
        importance: current.importance,
        urgency: current.urgency,
        complexity: current.complexity as Prisma.TaskCreateInput["complexity"],
        executorSource: current.assigneeId ? "human" : "none",
        checklist: readChecklist(current.checklist) as unknown as Prisma.InputJsonValue,
        recurrence: legacyJson(ruleSpec(rule)) as Prisma.InputJsonValue
      }
    });
    const dependencies = await tx.taskDependency.findMany({ where: { workspaceId: current.workspaceId, taskId: current.id } });
    if (dependencies.length) {
      await tx.taskDependency.createMany({
        data: dependencies.map((dependency) => ({ workspaceId: current.workspaceId, taskId: next.id, dependsOnTaskId: dependency.dependsOnTaskId }))
      });
    }
    await tx.taskRecurrenceInstance.create({
      data: {
        workspaceId: current.workspaceId,
        recurrenceId: rule.id,
        taskId: next.id,
        ordinal,
        scheduledFor: nextDue,
        status: "scheduled"
      }
    });
    await this.events.publishTx(tx, { workspaceId: current.workspaceId, actorId: null, type: "tasks.task.changed", payload: { id: next.id } });
    return next;
  }

  private async assertTaskTx(tx: Prisma.TransactionClient, workspaceId: string, taskId: string) {
    const task = await tx.task.findFirst({ where: { id: taskId, workspaceId } });
    if (!task) throw new NotFoundException("Задача не найдена");
    return task;
  }
}

type RuleRow = {
  id: string;
  workspaceId: string;
  templateId: string;
  freq: string;
  interval: number;
  weekdays: number[];
  endsMode: string;
  endsCount: number | null;
  endsAt: Date | null;
  generatedCount: number;
  anchorAt: Date;
  createdAt: Date;
  updatedAt: Date;
  instances: Array<{
    id: string;
    recurrenceId: string;
    taskId: string | null;
    ordinal: number;
    scheduledFor: Date;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

function ruleSpec(row: { freq: string; interval: number; weekdays: number[] }) {
  return { freq: row.freq as TaskRecurrenceFrequency, interval: row.interval, weekdays: row.weekdays };
}

/**
 * Снимает правило с шаблона: чистит legacy-поле `recurrence` у ВСЕХ задач
 * цепочки, чтобы завершение старого экземпляра не породило копию уже после
 * удаления правила, и удаляет правило (экземпляры каскадом).
 */
async function detachRuleTx(tx: Prisma.TransactionClient, workspaceId: string, templateId: string): Promise<void> {
  const rule = await tx.taskRecurrence.findUnique({ where: { templateId } });
  if (!rule || rule.workspaceId !== workspaceId) {
    await tx.task.updateMany({ where: { id: templateId, workspaceId }, data: { recurrence: Prisma.DbNull } });
    return;
  }
  const instances = await tx.taskRecurrenceInstance.findMany({ where: { recurrenceId: rule.id }, select: { taskId: true } });
  const taskIds = instances.flatMap((instance) => (instance.taskId ? [instance.taskId] : []));
  if (taskIds.length) {
    await tx.task.updateMany({ where: { id: { in: taskIds } }, data: { recurrence: Prisma.DbNull } });
  }
  await tx.taskRecurrence.delete({ where: { id: rule.id } });
}

function endsOf(row: { endsMode: string; endsCount: number | null; endsAt: Date | null }): TaskRecurrenceEnd {
  if (row.endsMode === "count") return { mode: "count", count: row.endsCount ?? 1 };
  if (row.endsMode === "until") return { mode: "until", until: (row.endsAt ?? new Date()).toISOString() };
  return { mode: "never" };
}

function legacyJson(spec: { freq: TaskRecurrenceFrequency; interval: number; weekdays: number[] }): LegacyTaskRecurrence | null {
  if (spec.freq === "weekdays") return null;
  if (spec.freq === "weekly" && spec.weekdays.length > 0) return null;
  return { freq: spec.freq, interval: spec.interval };
}

function readChecklist(value: Prisma.JsonValue): Array<{ id: string; title: string; done: boolean }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.title !== "string") return [];
    return [{ id: record.id, title: record.title, done: false }];
  });
}

function toInstanceDto(row: RuleRow["instances"][number]): TaskRecurrenceInstance {
  return {
    id: row.id,
    recurrenceId: row.recurrenceId,
    taskId: row.taskId,
    ordinal: row.ordinal,
    scheduledFor: row.scheduledFor.toISOString(),
    status: row.status as TaskRecurrenceInstance["status"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function toRuleDto(row: RuleRow): TaskRecurrenceRule {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    templateId: row.templateId,
    freq: row.freq as TaskRecurrenceRule["freq"],
    interval: row.interval,
    weekdays: row.weekdays,
    ends: endsOf(row),
    generatedCount: row.generatedCount,
    anchorAt: row.anchorAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    instances: row.instances.map(toInstanceDto)
  };
}

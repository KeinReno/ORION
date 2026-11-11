import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  type CreatePlanningBlockInput,
  type MovePlanningBlockInput,
  type PlanningBlock,
  type PlanningBlockImpact,
  type PlanningBlockMoveResult,
  type PlanningBlockState,
  type PlanningBlockType,
  type PlanningConflict,
  type UpdatePlanningBlockInput,
  planReschedule,
  type ImpactTaskInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { DomainEventBus } from "../domain-events/domain-event-bus";
import { EventOperations } from "../events/public/event-operations";
import { TaskIntegrationReader } from "../tasks/public/task-integration-reader";
import { TaskOperations } from "../tasks/public/task-operations";
import { ProjectReferences } from "../projects/public/project-references";
import { conflictsFor, type ConflictCandidate } from "./planning-conflicts";

/** Окно по умолчанию для списка: неделя назад и месяц вперёд — «мой план рядом». */
const DEFAULT_WINDOW_PAST_MS = 7 * 86_400_000;
const DEFAULT_WINDOW_FUTURE_MS = 30 * 86_400_000;

export interface PlanningBlockFilters {
  from?: string;
  to?: string;
  taskId?: string;
  projectId?: string;
  state?: string;
}

type BlockRow = Prisma.PlanningBlockGetPayload<Record<string, never>>;

/**
 * Тайм-блоки планирования (задание 04, п. 4.1).
 *
 * Ссылки на задачу и проект — не внешние ключи (см. schema.prisma): они
 * проверяются здесь через публичные контракты владельцев (`TaskIntegrationReader`,
 * `ProjectReferences`), поэтому удаление задачи не уносит блок и не требует,
 * чтобы модуль tasks был включён.
 *
 * Идемпотентность — `clientMutationId` (одно поле на блок, последняя операция):
 * повтор того же переноса возвращает сохранённое окно с `replayed: true` и не
 * публикует событие второй раз. Конкурентная правка — `revision`/`expectedRevision`,
 * как у заметок и задач.
 */
@Injectable()
export class PlanningBlocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly events: DomainEventBus,
    private readonly eventOperations: EventOperations,
    private readonly taskReferences: TaskIntegrationReader,
    private readonly taskOperations: TaskOperations,
    private readonly projectReferences: ProjectReferences
  ) {}

  async list(userId: string, workspaceId: string, filters: PlanningBlockFilters = {}): Promise<PlanningBlock[]> {
    const { from, to } = this.window(filters.from, filters.to);
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.planningBlock.findMany({
        where: {
          workspaceId,
          startAt: { lt: to },
          endAt: { gt: from },
          ...(filters.taskId ? { taskId: filters.taskId } : {}),
          ...(filters.projectId ? { projectId: filters.projectId } : {}),
          ...(filters.state ? { state: filters.state } : {})
        },
        orderBy: [{ startAt: "asc" }, { id: "asc" }]
      });
      const events = await this.eventsInWindow(tx, userId, workspaceId, from, to);
      const all = rows.map(toCandidate);
      return rows.map((row) => toDto(row, conflictsFor(toCandidate(row), all, events)));
    });
  }

  async get(userId: string, workspaceId: string, blockId: string): Promise<PlanningBlock> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await this.assertBlockTx(tx, workspaceId, blockId);
      return toDto(row, await this.conflictsForTx(tx, userId, workspaceId, row));
    });
  }

  async create(userId: string, workspaceId: string, input: CreatePlanningBlockInput): Promise<PlanningBlock> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      if (input.clientMutationId) {
        const existing = await tx.planningBlock.findUnique({
          where: { workspaceId_clientMutationId: { workspaceId, clientMutationId: input.clientMutationId } }
        });
        // Повтор уже принятой команды: не создаём второй блок, отдаём сохранённый.
        if (existing) return toDto(existing, await this.conflictsForTx(tx, userId, workspaceId, existing));
      }
      await this.assertReferencesTx(tx, workspaceId, input.taskId ?? null, input.projectId ?? null);
      const row = await tx.planningBlock.create({
        data: {
          workspaceId,
          taskId: input.taskId ?? null,
          projectId: input.projectId ?? null,
          title: input.title,
          note: input.note,
          type: input.type,
          state: input.state,
          startAt: new Date(input.startAt),
          endAt: new Date(input.endAt),
          clientMutationId: input.clientMutationId ?? null
        }
      });
      return toDto(row, await this.conflictsForTx(tx, userId, workspaceId, row));
    });
  }

  async update(userId: string, workspaceId: string, blockId: string, input: UpdatePlanningBlockInput): Promise<PlanningBlock> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const current = await this.assertBlockTx(tx, workspaceId, blockId);
      this.assertRevision(current, input.expectedRevision);
      const replay = await this.replayIfSameMutationTx(tx, workspaceId, current, input.clientMutationId);
      if (replay) return toDto(replay, await this.conflictsForTx(tx, userId, workspaceId, replay));

      const startAt = input.startAt ? new Date(input.startAt) : current.startAt;
      const endAt = input.endAt ? new Date(input.endAt) : current.endAt;
      this.assertRange(startAt, endAt);
      const taskId = input.taskId !== undefined ? input.taskId : current.taskId;
      const projectId = input.projectId !== undefined ? input.projectId : current.projectId;
      await this.assertReferencesTx(tx, workspaceId, taskId, projectId);

      const row = await tx.planningBlock.update({
        where: { id: blockId },
        data: {
          title: input.title,
          note: input.note,
          type: input.type,
          state: input.state,
          taskId,
          projectId,
          startAt: input.startAt ? startAt : undefined,
          endAt: input.endAt ? endAt : undefined,
          revision: current.revision + 1,
          clientMutationId: input.clientMutationId ?? current.clientMutationId
        }
      });
      return toDto(row, await this.conflictsForTx(tx, userId, workspaceId, row));
    });
  }

  /**
   * Перенос окна (в том числе между днями). Событие `planning.block.moved`
   * публикуется в той же транзакции и несёт оценку «что затронуто», чтобы
   * подписчики не пересчитывали её у себя.
   */
  async move(userId: string, workspaceId: string, blockId: string, input: MovePlanningBlockInput): Promise<PlanningBlockMoveResult> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const current = await this.assertBlockTx(tx, workspaceId, blockId);
      this.assertRevision(current, input.expectedRevision);

      const replay = await this.replayIfSameMutationTx(tx, workspaceId, current, input.clientMutationId);
      if (replay) {
        const conflicts = await this.conflictsForTx(tx, userId, workspaceId, replay);
        return { block: toDto(replay, conflicts), conflicts, impact: this.emptyImpact(replay.taskId), replayed: true };
      }

      const startAt = new Date(input.startAt);
      const durationMs = current.endAt.getTime() - current.startAt.getTime();
      const endAt = input.endAt ? new Date(input.endAt) : new Date(startAt.getTime() + durationMs);
      this.assertRange(startAt, endAt);
      const shiftMinutes = Math.round((startAt.getTime() - current.startAt.getTime()) / 60_000);

      const row = await tx.planningBlock.update({
        where: { id: blockId },
        data: {
          startAt,
          endAt,
          revision: current.revision + 1,
          clientMutationId: input.clientMutationId ?? current.clientMutationId
        }
      });

      const impact = await this.impactTx(tx, userId, workspaceId, row, shiftMinutes);
      await this.events.publishTx(tx, {
        workspaceId,
        actorId: userId,
        type: "planning.block.moved",
        payload: {
          id: row.id,
          taskId: row.taskId,
          startAt: row.startAt.toISOString(),
          endAt: row.endAt.toISOString(),
          shiftMinutes,
          affectedTaskIds: impact.affectedTaskIds,
          affectedBlockIds: impact.affectedBlockIds
        }
      });

      const conflicts = await this.conflictsForTx(tx, userId, workspaceId, row);
      return { block: toDto(row, conflicts), conflicts, impact, replayed: false };
    });
  }

  async remove(userId: string, workspaceId: string, blockId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertBlockTx(tx, workspaceId, blockId);
      await tx.planningBlock.delete({ where: { id: blockId } });
    });
  }

  // --- helpers -------------------------------------------------------------

  private window(fromISO?: string, toISO?: string): { from: Date; to: Date } {
    const now = Date.now();
    const from = fromISO ? new Date(fromISO) : new Date(now - DEFAULT_WINDOW_PAST_MS);
    const to = toISO ? new Date(toISO) : new Date(now + DEFAULT_WINDOW_FUTURE_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new BadRequestException("Некорректное окно запроса (from/to)");
    if (from >= to) throw new BadRequestException("Начало окна должно быть раньше конца");
    return { from, to };
  }

  private assertRange(startAt: Date, endAt: Date): void {
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) throw new BadRequestException("Некорректные даты");
    if (endAt <= startAt) throw new BadRequestException("Конец должен быть позже начала");
  }

  private assertRevision(current: BlockRow, expectedRevision?: number): void {
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw new ConflictException({
        code: "planning_block_revision_conflict",
        currentRevision: current.revision,
        message: "Блок уже изменён — обновите и повторите"
      });
    }
  }

  /** Тот же `clientMutationId`, что уже сохранён на блоке, — повтор, а не новая операция. */
  private async replayIfSameMutationTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    current: BlockRow,
    clientMutationId: string | null | undefined
  ): Promise<BlockRow | null> {
    if (!clientMutationId) return null;
    if (current.clientMutationId === clientMutationId) return current;
    const owner = await tx.planningBlock.findUnique({
      where: { workspaceId_clientMutationId: { workspaceId, clientMutationId } },
      select: { id: true }
    });
    if (owner && owner.id !== current.id) {
      throw new ConflictException({
        code: "planning_block_mutation_conflict",
        message: "Этот clientMutationId уже принадлежит другому блоку"
      });
    }
    return null;
  }

  private async assertBlockTx(tx: Prisma.TransactionClient, workspaceId: string, blockId: string): Promise<BlockRow> {
    const row = await tx.planningBlock.findUnique({ where: { id: blockId } });
    if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Тайм-блок не найден");
    return row;
  }

  /** Задача и проект — только из этого пространства (членство в двух не разрешает смешивать). */
  private async assertReferencesTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    taskId: string | null,
    projectId: string | null
  ): Promise<void> {
    if (taskId) {
      const task = await this.taskReferences.referenceTx(tx, workspaceId, taskId);
      if (!task) throw new NotFoundException("Задача не найдена");
    }
    if (projectId && !(await this.projectReferences.existsTx(tx, workspaceId, projectId))) {
      throw new NotFoundException("Проект не найден");
    }
  }

  private async conflictsForTx(
    tx: Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
    row: BlockRow
  ): Promise<PlanningConflict[]> {
    const others = await tx.planningBlock.findMany({
      where: { workspaceId, id: { not: row.id }, startAt: { lt: row.endAt }, endAt: { gt: row.startAt } },
      select: { id: true, title: true, startAt: true, endAt: true }
    });
    const events = await this.eventsInWindow(tx, userId, workspaceId, row.startAt, row.endAt);
    return conflictsFor(toCandidate(row), others.map(toCandidate), events);
  }

  /** События календаря участвуют в конфликтах только когда календарь включён. */
  private async eventsInWindow(
    tx: Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
    from: Date,
    to: Date
  ): Promise<ConflictCandidate[]> {
    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { disabledModules: true } });
    if (!workspace || workspace.disabledModules.includes("calendar")) return [];
    const events = await this.eventOperations.list(userId, workspaceId, from.toISOString(), to.toISOString());
    return events.map((event) => ({ id: event.id, title: event.title, startAt: event.startAt, endAt: event.endAt }));
  }

  private emptyImpact(taskId: string | null): PlanningBlockImpact {
    return { taskId, shiftMinutes: 0, affectedTaskIds: [], affectedBlockIds: [], affectedMilestoneIds: [] };
  }

  /**
   * Оценка последствий переноса блока: другие блоки той же задачи и зависимые
   * задачи (finish-to-start). Ничего не меняет — это прогноз для ответа и события.
   */
  private async impactTx(
    tx: Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
    block: BlockRow,
    shiftMinutes: number
  ): Promise<PlanningBlockImpact> {
    const siblings = await tx.planningBlock.findMany({
      where: { workspaceId, taskId: block.taskId ?? "__none__", id: { not: block.id } },
      select: { id: true }
    });
    const impact = this.emptyImpact(block.taskId);
    impact.shiftMinutes = shiftMinutes;
    impact.affectedBlockIds = siblings.map((row) => row.id);
    if (!block.taskId) return impact;

    const tasks = await this.taskOperations.list(userId, workspaceId);
    const nodes: ImpactTaskInput[] = tasks.map((task) => ({
      id: task.id,
      title: task.title,
      startAt: task.startAt,
      dueAt: task.dueAt,
      dependsOn: task.dependencyIds,
      milestoneId: task.milestoneId
    }));
    const moved = tasks.find((task) => task.id === block.taskId);
    if (!moved) return impact;
    const plan = planReschedule({
      tasks: nodes,
      movedTaskId: moved.id,
      newStartAt: shiftIso(moved.startAt, shiftMinutes),
      newDueAt: shiftIso(moved.dueAt, shiftMinutes)
    });
    if (!plan) return impact;
    impact.affectedTaskIds = plan.tasks.map((item) => item.id);
    const milestoneByTask = new Map(nodes.map((node) => [node.id, node.milestoneId]));
    impact.affectedMilestoneIds = [
      ...new Set(plan.tasks.map((item) => milestoneByTask.get(item.id)).filter((id): id is string => Boolean(id)))
    ];
    return impact;
  }
}

function shiftIso(value: string | null, shiftMinutes: number): string | null {
  if (!value) return null;
  return new Date(new Date(value).getTime() + shiftMinutes * 60_000).toISOString();
}

function toCandidate(row: { id: string; title: string; startAt: Date; endAt: Date }): ConflictCandidate {
  return { id: row.id, title: row.title, startAt: row.startAt, endAt: row.endAt };
}

function toDto(row: BlockRow, conflicts: PlanningConflict[]): PlanningBlock {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    taskId: row.taskId,
    projectId: row.projectId,
    title: row.title,
    note: row.note,
    type: row.type as PlanningBlockType,
    state: row.state as PlanningBlockState,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    revision: row.revision,
    clientMutationId: row.clientMutationId,
    conflicts,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

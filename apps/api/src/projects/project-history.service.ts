import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  projectFieldChanges,
  type LinkProjectHistoryDecisionInput,
  type ProjectFieldChange,
  type ProjectHistoryEntry,
  type ProjectHistoryPage,
  type ProjectHistoryQuery
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { DomainEventBus } from "../domain-events/domain-event-bus";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ProjectHierarchyRepository } from "./project-hierarchy.repository";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type Tx = Prisma.TransactionClient;

/**
 * Audit trail проекта (задание 03, 3.4). Пишется в ТОЙ ЖЕ транзакции, что и изменение
 * (`ProjectsService.update`), поэтому история не может «отстать» от данных или записать
 * изменение, которое откатилось.
 *
 * Доменные события — параллельный, а не единственный носитель истории: `domain_events`
 * чистится через 7 дней и не входит в резервную копию, а «кто изменил срок» должно
 * переживать и чистку, и восстановление. Поэтому строка истории — источник истины для
 * чтения, а событие `projects.project.updated` уходит на шину для других модулей.
 */
@Injectable()
export class ProjectHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly events: DomainEventBus,
    private readonly hierarchy: ProjectHierarchyRepository
  ) {}

  /**
   * Записывает изменения полей и публикует событие. Возвращает число записей.
   * Смена родителя дополнительно объявляется отдельным событием
   * `projects.project.parent_changed` — это отдельная семантика дерева, а не
   * «ещё одно поле», и подписчикам нужен прежний родитель.
   */
  async recordTx(
    tx: Tx,
    input: { workspaceId: string; projectId: string; actorId: string | null; changes: ProjectFieldChange[] }
  ): Promise<number> {
    if (input.changes.length === 0) return 0;
    const eventId = await this.events.publishTx(tx, {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      type: "projects.project.updated",
      payload: { id: input.projectId, changes: input.changes.map((change) => ({ field: change.field, from: change.from, to: change.to })) }
    });
    const parentChange = input.changes.find((change) => change.field === "parentId");
    if (parentChange) {
      await this.events.publishTx(tx, {
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        type: "projects.project.parent_changed",
        payload: { id: input.projectId, parentId: parentChange.to, previousParentId: parentChange.from }
      });
    }
    await tx.projectHistoryEntry.createMany({
      data: input.changes.map((change) => ({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        actorId: input.actorId,
        field: change.field,
        fromValue: change.from,
        toValue: change.to,
        eventId
      }))
    });
    return input.changes.length;
  }

  /** Разница «что реально поменялось» — общая функция контракта, не локальная копия. */
  changesBetween(before: Record<string, unknown>, patch: Record<string, unknown>): ProjectFieldChange[] {
    return projectFieldChanges(before, patch);
  }

  async list(userId: string, workspaceId: string, projectId: string, query: ProjectHistoryQuery): Promise<ProjectHistoryPage> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertProjectTx(tx, workspaceId, projectId);

      const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      const offset = query.offset ?? 0;
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.from) createdAt.gte = new Date(query.from);
      if (query.to) createdAt.lte = new Date(query.to);
      const where: Prisma.ProjectHistoryEntryWhereInput = {
        workspaceId,
        projectId,
        ...(query.field ? { field: query.field } : {}),
        ...(query.from || query.to ? { createdAt } : {})
      };
      const [total, rows] = await Promise.all([
        tx.projectHistoryEntry.count({ where }),
        tx.projectHistoryEntry.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: offset,
          take: limit
        })
      ]);
      const names = await this.actorNames(tx, rows.map((row) => row.actorId));
      return { items: rows.map((row) => toDto(row, names)), total, offset, limit };
    });
  }

  /**
   * Отнести изменение к записи журнала — «решение» (задание 03: связывание истории с
   * журналом). Связь хранится ссылкой на запись журнала, а не копией её текста: запись
   * остаётся единственным источником истины, а её правка/удаление не расходится с историей.
   */
  async linkDecision(
    userId: string,
    workspaceId: string,
    projectId: string,
    historyId: string,
    input: LinkProjectHistoryDecisionInput
  ): Promise<ProjectHistoryEntry> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertProjectTx(tx, workspaceId, projectId);
      const entry = await tx.projectLogEntry.findFirst({
        where: { id: input.entryId, workspaceId, projectId },
        select: { id: true }
      });
      if (!entry) throw new NotFoundException("Запись журнала не найдена в этом проекте");
      const row = await this.assertHistoryTx(tx, workspaceId, projectId, historyId);
      if (row.logEntryId === entry.id) throw new BadRequestException("Изменение уже отнесено к этой записи");
      const updated = await tx.projectHistoryEntry.update({ where: { id: historyId }, data: { logEntryId: entry.id } });
      return toDto(updated, await this.actorNames(tx, [updated.actorId]));
    });
  }

  async unlinkDecision(userId: string, workspaceId: string, projectId: string, historyId: string): Promise<ProjectHistoryEntry> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertProjectTx(tx, workspaceId, projectId);
      const row = await this.assertHistoryTx(tx, workspaceId, projectId, historyId);
      if (!row.logEntryId) throw new BadRequestException("Изменение не связано с записью журнала");
      const updated = await tx.projectHistoryEntry.update({ where: { id: historyId }, data: { logEntryId: null } });
      return toDto(updated, await this.actorNames(tx, [updated.actorId]));
    });
  }

  /** Стоит ли вообще поднимать дерево: проверка «родитель не потомок» уже внутри hierarchy. */
  async assertProjectTx(tx: Tx, workspaceId: string, projectId: string): Promise<void> {
    const project = await tx.project.findFirst({ where: { id: projectId, workspaceId }, select: { id: true } });
    if (!project) throw new NotFoundException("Проект не найден");
  }

  private async assertHistoryTx(tx: Tx, workspaceId: string, projectId: string, historyId: string) {
    const row = await tx.projectHistoryEntry.findUnique({ where: { id: historyId } });
    if (!row || row.workspaceId !== workspaceId || row.projectId !== projectId) throw new NotFoundException("Изменение не найдено");
    return row;
  }

  private async actorNames(tx: Tx, actorIds: Array<string | null>): Promise<Map<string, string>> {
    const ids = [...new Set(actorIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map();
    const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}

type HistoryRow = {
  id: string;
  workspaceId: string;
  projectId: string;
  actorId: string | null;
  field: string;
  fromValue: string | null;
  toValue: string | null;
  eventId: string | null;
  logEntryId: string | null;
  createdAt: Date;
};

function toDto(row: HistoryRow, names: Map<string, string>): ProjectHistoryEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    actorId: row.actorId,
    actorName: row.actorId ? names.get(row.actorId) ?? null : null,
    field: row.field,
    fromValue: row.fromValue,
    toValue: row.toValue,
    eventId: row.eventId,
    logEntryId: row.logEntryId,
    createdAt: row.createdAt.toISOString()
  };
}

// Экспорт для тестов и повторного использования: репозиторий дерева нужен и сервису проектов.
export type { ProjectHierarchyRepository };

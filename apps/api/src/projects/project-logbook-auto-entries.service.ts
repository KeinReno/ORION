import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { parseDomainEventPayload, type DomainEventEnvelope } from "@orion/shared-types";
import { DomainEventBus } from "../domain-events/domain-event-bus";
import { TaskReferenceReader } from "../tasks/public/task-reference-reader";
import { ProjectLogbookService } from "./project-logbook.service";

/**
 * Автозаписи журнала (задание 05). Подписчик живёт на плагине
 * `projects-logbook`: выключили плагин — доставки `skipped_disabled`, новых
 * записей нет, прежние сохраняются.
 *
 * At-least-once шины компенсируется `dedupeKey` в записи: bulk-операция несёт
 * общий `bulkId`, и повторная доставка того же события не создаёт вторую
 * строку (unique index `(projectId, dedupeKey)`).
 */
@Injectable()
export class ProjectLogbookAutoEntriesService implements OnModuleInit {
  constructor(
    private readonly bus: DomainEventBus,
    private readonly logbook: ProjectLogbookService,
    private readonly taskReferences: TaskReferenceReader
  ) {}

  onModuleInit(): void {
    this.bus.subscribe({
      id: "projects.logbook-auto-entries",
      componentId: "projects-logbook",
      types: [
        "projects.project.status_changed",
        "projects.project.dates_changed",
        "projects.milestone.completed",
        "projects.milestone.dates_changed",
        "tasks.task.assigned"
      ],
      handle: (event, tx) => this.handle(event, tx)
    });
  }

  async handle(event: DomainEventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
    const common = { sourceEventId: event.id, sourceEventType: event.type, actorId: event.actorId };
    switch (event.type) {
      case "projects.project.status_changed": {
        const payload = parseDomainEventPayload(event.type, event.payload);
        await this.logbook.recordAutoEntryTx(tx, {
          ...common,
          workspaceId: event.workspaceId,
          projectId: payload.id,
          text: payload.bulkLabel ?? `Статус проекта: ${payload.from} → ${payload.to}`,
          bulkId: payload.bulkId
        });
        return;
      }
      case "projects.project.dates_changed": {
        const payload = parseDomainEventPayload(event.type, event.payload);
        const text = payload.bulkLabel ?? `Сроки проекта: ${dateRange(payload.startAtFrom, payload.startAtTo)}, дедлайн ${dateRange(payload.dueAtFrom, payload.dueAtTo)}`;
        await this.logbook.recordAutoEntryTx(tx, {
          ...common,
          workspaceId: event.workspaceId,
          projectId: payload.id,
          text,
          bulkId: payload.bulkId
        });
        return;
      }
      case "projects.milestone.completed": {
        const payload = parseDomainEventPayload(event.type, event.payload);
        await this.logbook.recordAutoEntryTx(tx, {
          ...common,
          workspaceId: event.workspaceId,
          projectId: payload.projectId,
          text: payload.bulkLabel ?? `Веха завершена: «${payload.title}»`,
          bulkId: payload.bulkId
        });
        return;
      }
      case "projects.milestone.dates_changed": {
        const payload = parseDomainEventPayload(event.type, event.payload);
        await this.logbook.recordAutoEntryTx(tx, {
          ...common,
          workspaceId: event.workspaceId,
          projectId: payload.projectId,
          text: payload.bulkLabel ?? `Сроки вехи «${payload.title}»: ${dateRange(null, payload.startAt)} — ${dateRange(null, payload.dueAt)}`,
          bulkId: payload.bulkId
        });
        return;
      }
      case "tasks.task.assigned": {
        const payload = parseDomainEventPayload(event.type, event.payload);
        // Задача могла быть удалена/перенесена между публикацией и доставкой.
        // Читаем публичную проекцию Tasks, а не её таблицу: модуль журнала не
        // владеет задачами (архитектурный гейт).
        const [task] = await this.taskReferences.byIdsTx(tx, event.workspaceId, [payload.id]);
        if (!task || !task.projectId) return;
        const [assignee, previous] = await Promise.all([
          tx.user.findUnique({ where: { id: payload.assigneeId }, select: { name: true } }),
          payload.previousAssigneeId ? tx.user.findUnique({ where: { id: payload.previousAssigneeId }, select: { name: true } }) : null
        ]);
        const text = payload.bulkLabel ?? (previous?.name
          ? `Исполнитель задачи «${task.title}»: ${previous.name} → ${assignee?.name ?? "—"}`
          : `Исполнитель задачи «${task.title}»: ${assignee?.name ?? "—"}`);
        await this.logbook.recordAutoEntryTx(tx, {
          ...common,
          workspaceId: event.workspaceId,
          projectId: task.projectId,
          text,
          bulkId: payload.bulkId
        });
        return;
      }
      default:
        return;
    }
  }
}

function dateRange(from: string | null, to: string | null): string {
  const left = formatDate(from);
  const right = formatDate(to);
  if (left === right) return left;
  return `${left} → ${right}`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}

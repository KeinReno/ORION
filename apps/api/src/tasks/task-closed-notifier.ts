import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { parseDomainEventPayload, type DomainEventEnvelope } from "@orion/shared-types";
import { DomainEventBus, restoreSystemRole } from "../domain-events/domain-event-bus";
import { NotificationCenterService } from "../notifications/notification-center.service";
import { NotificationPolicyService } from "../notifications/notification-policy.service";

/**
 * Первый подписчик Event API (ADR-0019): когда задачу закрывает НЕ исполнитель, исполнитель получает уведомление
 * в ленте. Это аддитивная реакция — синхронный TaskClosureRegistry (остановка таймера владельцем Time)
 * остаётся отдельным: таймер должен остановиться синхронно с ответом на запрос, а событие приходит с задержкой
 * диспетчера. Для одного пользователя в пространстве поведение не меняется (свои действия не уведомляют).
 *
 * Идемпотентность: `eventKey = task_closed:<eventId>` + `createMany/skipDuplicates` внутри `createTx`.
 */
@Injectable()
export class TaskClosedNotifier implements OnModuleInit {
  constructor(
    private readonly bus: DomainEventBus,
    private readonly notifications: NotificationCenterService,
    private readonly policy: NotificationPolicyService
  ) {}

  onModuleInit(): void {
    this.bus.subscribe({
      id: "tasks.notify-assignee-on-close",
      componentId: "tasks",
      types: ["tasks.task.closed"],
      handle: (event, tx) => this.handle(event, tx)
    });
  }

  async handle(event: DomainEventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
    const payload = parseDomainEventPayload("tasks.task.closed", event.payload);
    if (!payload.assigneeId) return;
    const assignee = await tx.workspaceMember.findUnique({ where: { id: payload.assigneeId }, select: { userId: true } });
    // Агентское членство (задание 12) не имеет `User` — уведомление в личную ленту ему адресовать некуда.
    if (!assignee?.userId) return;
    const recipientId = assignee.userId;
    const allowed = await this.policy.allowsForUserTx(tx, recipientId, "task");
    await restoreSystemRole(tx); // allowsForUserTx ends with RESET ROLE
    if (!allowed) return;
    const task = await tx.task.findUnique({ where: { id: payload.id }, select: { title: true } });
    if (!task) return;
    await this.notifications.createTx(tx, {
      workspaceId: event.workspaceId,
      recipientId,
      kind: "system",
      title: `Задача закрыта: ${task.title}`,
      entityType: "task",
      entityId: payload.id,
      eventKey: `task_closed:${event.id}`,
      actorId: event.actorId ?? undefined
    });
  }
}

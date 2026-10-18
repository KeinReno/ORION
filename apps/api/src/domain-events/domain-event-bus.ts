import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  DOMAIN_EVENT_CATALOG,
  DOMAIN_EVENT_SUBSCRIPTIONS,
  isDomainEventType,
  parseDomainEventPayload,
  type DomainEventEnvelope,
  type DomainEventPayloads,
  type DomainEventType
} from "@orion/shared-types";
import { subscribersFor } from "./delivery-policy";

/**
 * Помощники вроде `NotificationPolicyService.allowsForUserTx` делают `RESET ROLE` (возврат к orion_app) внутри
 * чужой транзакции. Обработчик, который после такого вызова продолжает писать, обязан вернуть системную роль.
 */
export function restoreSystemRole(tx: Prisma.TransactionClient): Promise<number> {
  return tx.$executeRawUnsafe("SET LOCAL ROLE orion_system");
}

export interface DomainEventSubscriber {
  /** Уникален в системе; вместе с id события образует ключ доставки (eventId, subscriberId). */
  id: string;
  /** Модуль или плагин-владелец: выключен в пространстве → доставка `skipped_disabled`. */
  componentId: string;
  types: readonly DomainEventType[];
  /**
   * Вызывается диспетчером внутри `asSystem`-транзакции той же доставки и в SAVEPOINT (после вызова диспетчер сам
   * возвращает роль orion_system; внутри обработчика — см. `restoreSystemRole`): исключение откатывает записи
   * обработчика и планирует повтор. At-least-once → обработчик ОБЯЗАН быть идемпотентным (ключ — `event.id`).
   */
  handle(event: DomainEventEnvelope, tx: Prisma.TransactionClient): Promise<void>;
}

export interface PublishDomainEvent<T extends DomainEventType> {
  workspaceId: string;
  type: T;
  payload: DomainEventPayloads[T];
  /** Пользователь-инициатор; null/пусто для cron и системных публикаций. */
  actorId?: string | null;
}

/**
 * Шина доменных событий (ADR-0019): transactional outbox. Публикация — вставка строки в `domain_events` внутри
 * транзакции записи вызывающего; подписчиков знает только диспетчер, поэтому публикация никогда не падает из-за них.
 */
@Injectable()
export class DomainEventBus {
  private readonly subscribers = new Map<string, DomainEventSubscriber>();

  /** Вставляет событие в outbox в транзакции `tx` (обычно `PrismaService.withUser`). Откат tx откатывает событие. */
  async publishTx<T extends DomainEventType>(tx: Prisma.TransactionClient, event: PublishDomainEvent<T>): Promise<string> {
    if (!isDomainEventType(event.type)) throw new Error(`Неизвестный тип доменного события: ${event.type}`);
    const payload = parseDomainEventPayload(event.type, event.payload);
    const row = await tx.domainEvent.create({
      data: {
        workspaceId: event.workspaceId,
        type: event.type,
        version: DOMAIN_EVENT_CATALOG[event.type].version,
        payload: payload as Prisma.InputJsonValue,
        actorId: event.actorId ?? null
      },
      select: { id: true }
    });
    return row.id;
  }

  /**
   * Регистрирует подписчика. Должен совпасть с объявлением в `DOMAIN_EVENT_SUBSCRIPTIONS` (источник
   * `events.subscribes` манифестов) — иначе падает при старте, а не молча расходится с манифестом.
   */
  subscribe(subscriber: DomainEventSubscriber): void {
    if (this.subscribers.has(subscriber.id)) throw new Error(`Подписчик доменных событий уже зарегистрирован: ${subscriber.id}`);
    const declared = DOMAIN_EVENT_SUBSCRIPTIONS.find((d) => d.id === subscriber.id);
    if (!declared) throw new Error(`Подписчик ${subscriber.id} не объявлен в DOMAIN_EVENT_SUBSCRIPTIONS`);
    const sameTypes =
      declared.types.length === subscriber.types.length && declared.types.every((t) => (subscriber.types as readonly string[]).includes(t));
    if (declared.componentId !== subscriber.componentId || !sameTypes) {
      throw new Error(`Подписчик ${subscriber.id} расходится с объявлением в DOMAIN_EVENT_SUBSCRIPTIONS`);
    }
    this.subscribers.set(subscriber.id, subscriber);
  }

  subscriberById(id: string): DomainEventSubscriber | undefined {
    return this.subscribers.get(id);
  }

  subscribersFor(type: string): DomainEventSubscriber[] {
    return subscribersFor(this.subscribers.values(), type);
  }
}

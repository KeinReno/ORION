import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { Prisma } from "@prisma/client";
import type { DomainEventEnvelope, DomainEventType } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { DomainEventBus, restoreSystemRole } from "./domain-event-bus";
import { isComponentEnabled, nextAttemptAt, statusAfterFailure } from "./delivery-policy";

const FANOUT_BATCH = 100;
const DELIVERY_BATCH = 100;
const RETENTION_DAYS = 7;

interface ClaimedDelivery {
  id: string;
  eventId: string;
  subscriberId: string;
  workspaceId: string;
  attempts: number;
}

/**
 * Диспетчер outbox (ADR-0019). Всё идёт под `asSystem` (как остальные кроны): у фоновой задачи нет «текущего
 * пользователя». Два шага: (1) разложить новые события по подписчикам (`FOR UPDATE SKIP LOCKED`, доставки
 * `createMany` + `skipDuplicates`); (2) по одной доставке за транзакцию выполнить обработчик в SAVEPOINT — запись
 * обработчика и отметка «done» атомарны, при сбое откатывается только обработчик, а попытка и пауза фиксируются.
 */
@Injectable()
export class DomainEventDispatcherService {
  private readonly logger = new Logger(DomainEventDispatcherService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: DomainEventBus
  ) {}

  @Cron("*/10 * * * * *")
  async handleCron(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error(`Диспетчер доменных событий упал: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  @Cron("0 4 * * *")
  async handlePurgeCron(): Promise<void> {
    try {
      await this.purgeOld();
    } catch (err) {
      this.logger.error(`Чистка outbox упала: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Один проход: раскладка + доставка. Публичен для тестов и ручного запуска. */
  async runOnce(clock?: Date): Promise<{ fannedOut: number; delivered: number; failed: number; skipped: number }> {
    const fannedOut = await this.fanOut();
    // Taken after the fan-out: new deliveries get `nextAttemptAt = now()` inside the fan-out transaction, which is later
    // than a timestamp captured before it.
    const now = clock ?? new Date();
    let delivered = 0;
    let failed = 0;
    let skipped = 0;
    for (let i = 0; i < DELIVERY_BATCH; i++) {
      const outcome = await this.deliverNext(now);
      if (outcome === "none") break;
      if (outcome === "done") delivered++;
      else if (outcome === "skipped") skipped++;
      else if (outcome === "failed") failed++;
    }
    return { fannedOut, delivered, failed, skipped };
  }

  private async fanOut(): Promise<number> {
    return this.prisma.asSystem(async (tx) => {
      const events = await tx.$queryRaw<Array<{ id: string; type: string; workspaceId: string }>>`
        SELECT "id", "type", "workspaceId" FROM "domain_events"
        WHERE "dispatchedAt" IS NULL
        ORDER BY "createdAt", "id"
        LIMIT ${FANOUT_BATCH}
        FOR UPDATE SKIP LOCKED`;
      for (const event of events) {
        const rows = this.bus.subscribersFor(event.type).map((s) => ({
          workspaceId: event.workspaceId,
          eventId: event.id,
          subscriberId: s.id
        }));
        if (rows.length) await tx.domainEventDelivery.createMany({ data: rows, skipDuplicates: true });
      }
      if (events.length) {
        await tx.domainEvent.updateMany({ where: { id: { in: events.map((e) => e.id) } }, data: { dispatchedAt: new Date() } });
      }
      return events.length;
    });
  }

  private async deliverNext(now: Date): Promise<"none" | "done" | "skipped" | "failed" | "retry"> {
    return this.prisma.asSystem(async (tx) => {
      const [claimed] = await tx.$queryRaw<ClaimedDelivery[]>`
        SELECT "id", "eventId", "subscriberId", "workspaceId", "attempts" FROM "domain_event_deliveries"
        WHERE "status" = 'pending' AND "nextAttemptAt" <= ${now}
        ORDER BY "nextAttemptAt", "id"
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      if (!claimed) return "none";


      const finish = (status: string, extra: Prisma.DomainEventDeliveryUpdateInput = {}) =>
        tx.domainEventDelivery.update({ where: { id: claimed.id }, data: { status, completedAt: new Date(), ...extra } });

      const subscriber = this.bus.subscriberById(claimed.subscriberId);
      if (!subscriber) {
        await finish("failed", { attempts: claimed.attempts + 1, lastError: "Подписчик не зарегистрирован" });
        return "failed";
      }
      const workspace = await tx.workspace.findUnique({
        where: { id: claimed.workspaceId },
        select: { disabledModules: true, pluginOverrides: true }
      });
      if (!workspace || !isComponentEnabled(subscriber.componentId, workspace)) {
        // Выключенный подписчик: не повторяем и не воспроизводим при включении (EVENTS.md).
        await finish("skipped_disabled");
        return "skipped";
      }
      const row = await tx.domainEvent.findUnique({ where: { id: claimed.eventId } });
      if (!row) {
        await finish("failed", { lastError: "Событие не найдено" });
        return "failed";
      }
      const envelope = {
        id: row.id,
        type: row.type as DomainEventType,
        version: row.version,
        workspaceId: row.workspaceId,
        actorId: row.actorId,
        occurredAt: row.createdAt.toISOString(),
        payload: row.payload
      } as DomainEventEnvelope;

      await tx.$executeRawUnsafe("SAVEPOINT domain_event_handler");
      try {
        await subscriber.handle(envelope, tx);
        await restoreSystemRole(tx);
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT domain_event_handler");
      } catch (err) {
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT domain_event_handler");
        await restoreSystemRole(tx);
        const attempts = claimed.attempts + 1;
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        const status = statusAfterFailure(attempts);
        this.logger.warn(`Доставка ${subscriber.id} события ${row.id} (${row.type}) не удалась, попытка ${attempts}: ${message}`);
        await tx.domainEventDelivery.update({
          where: { id: claimed.id },
          data: {
            attempts,
            lastError: message,
            status,
            nextAttemptAt: nextAttemptAt(attempts, new Date()),
            completedAt: status === "failed" ? new Date() : null
          }
        });
        return status === "failed" ? "failed" : "retry";
      }
      await finish("done", { attempts: claimed.attempts + 1, lastError: null });
      return "done";
    });
  }

  /** Чистка: обработанные события старше недели без ожидающих/упавших доставок (упавшие остаются для диагностики). */
  async purgeOld(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60_000);
    return this.prisma.asSystem(async (tx) => {
      const res = await tx.domainEvent.deleteMany({
        where: {
          dispatchedAt: { lt: cutoff },
          deliveries: { none: { status: { in: ["pending", "failed"] } } }
        }
      });
      return res.count;
    });
  }
}

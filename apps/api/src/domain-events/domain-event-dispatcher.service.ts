import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import {
  DOMAIN_EVENT_CATALOG,
  isDomainEventType,
  parseDomainEventPayload,
  type DomainEventEnvelope,
  type DomainEventOutboxStatus
} from "@orion/shared-types";
import { BackgroundJobsService } from "../common/background-jobs.service";
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: DomainEventBus,
    private readonly jobs: BackgroundJobsService
  ) {}

  /** G9: the wrapper logs, counts and guards against overlap, so a slow pass never runs twice at once. */
  @Cron("*/10 * * * * *")
  async handleCron(): Promise<void> {
    await this.jobs.runJob("core", "domain-events-dispatch", () => this.runOnce());
  }

  @Cron("0 4 * * *")
  async handlePurgeCron(): Promise<void> {
    await this.jobs.runJob("core", "domain-events-purge", () => this.purgeOld());
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
      // Parent before child: workspace deletion holds the workspace row before
      // cascading to events. Locking events first, then inserting deliveries
      // (which need an FK key-share on workspace), inverted that order and could
      // deadlock. Skip deleting/locked parents; their events remain undispatched
      // for a later pass if the parent transaction rolls back.
      const workspaces = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT w."id" FROM "workspaces" w
        WHERE w."id" IN (
          SELECT "workspaceId" FROM "domain_events" WHERE "dispatchedAt" IS NULL
          ORDER BY "createdAt", "id" LIMIT ${FANOUT_BATCH}
        )
        ORDER BY w."id"
        FOR KEY SHARE OF w SKIP LOCKED`;
      if (!workspaces.length) return 0;
      const events = await tx.$queryRaw<Array<{ id: string; type: string; workspaceId: string }>>`
        SELECT "id", "type", "workspaceId" FROM "domain_events"
        WHERE "dispatchedAt" IS NULL AND "workspaceId" IN (${Prisma.join(workspaces.map((w) => w.id))})
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
      // `nextAttemptAt` is `timestamp without time zone` holding UTC wall time (as Prisma writes it). A bare Date
      // parameter arrives as timestamptz, and Postgres would read the column in the session zone — on a Moscow
      // server every backoff looked 3 h overdue and a failing handler burned all attempts in one pass. Same
      // `::timestamp` idiom as time.service / execution.service.
      const [claimed] = await tx.$queryRaw<ClaimedDelivery[]>`
        SELECT "id", "eventId", "subscriberId", "workspaceId", "attempts" FROM "domain_event_deliveries"
        WHERE "status" = 'pending' AND "nextAttemptAt" <= ${now.toISOString()}::timestamp
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
      // Delivery-time contract check: a type that left the catalog, a payload version the
      // catalog no longer speaks, or a payload that no longer parses must become a visible
      // failed delivery, not an exception thrown from an arbitrary consumer.
      if (!isDomainEventType(row.type)) {
        await finish("failed", { attempts: claimed.attempts + 1, lastError: `Неизвестный тип события: ${row.type}` });
        return "failed";
      }
      const definition = DOMAIN_EVENT_CATALOG[row.type];
      if (row.version !== definition.version) {
        await finish("failed", {
          attempts: claimed.attempts + 1,
          lastError: `Версия payload ${row.version} не совпадает с каталогом (${definition.version})`
        });
        return "failed";
      }
      let payload: DomainEventEnvelope["payload"];
      try {
        payload = parseDomainEventPayload(row.type, row.payload);
      } catch (error) {
        await finish("failed", {
          attempts: claimed.attempts + 1,
          lastError: `Payload не соответствует схеме: ${error instanceof Error ? error.message : String(error)}`
        });
        return "failed";
      }
      const envelope = {
        id: row.id,
        type: row.type,
        version: row.version,
        workspaceId: row.workspaceId,
        actorId: row.actorId,
        occurredAt: row.createdAt.toISOString(),
        payload
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

  /**
   * Foundation Core (task 01.2): состояние outbox для диагностики. `workspaceId` optional —
   * без него это общесистемные счётчики (без payload и без имён пространств).
   */
  async status(workspaceId?: string): Promise<DomainEventOutboxStatus> {
    return this.prisma.asSystem(async (tx) => {
      const scope = workspaceId ? { workspaceId } : {};
      const counts = await tx.domainEventDelivery.groupBy({ by: ["status"], where: scope, _count: { _all: true } });
      const byStatus = new Map(counts.map((row) => [row.status, row._count._all]));
      const [oldestEvent, oldestDelivery, byType, failed] = await Promise.all([
        tx.domainEvent.findFirst({ where: { ...scope, dispatchedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
        tx.domainEventDelivery.findFirst({
          where: { ...scope, status: "pending" },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true }
        }),
        tx.domainEvent.groupBy({ by: ["type"], where: { ...scope, dispatchedAt: null }, _count: { _all: true } }),
        tx.domainEventDelivery.findMany({
          where: { ...scope, status: "failed" },
          orderBy: [{ completedAt: "desc" }, { id: "desc" }],
          take: 20,
          include: { event: { select: { type: true } } }
        })
      ]);
      const now = Date.now();
      const age = (date: Date | null | undefined): number | null =>
        date ? Math.max(0, Math.floor((now - date.getTime()) / 1000)) : null;
      return {
        pending: byStatus.get("pending") ?? 0,
        done: byStatus.get("done") ?? 0,
        skippedDisabled: byStatus.get("skipped_disabled") ?? 0,
        failed: byStatus.get("failed") ?? 0,
        oldestUndispatchedAgeSeconds: age(oldestEvent?.createdAt),
        oldestPendingAgeSeconds: age(oldestDelivery?.createdAt),
        undeliveredByType: byType
          .map((row) => ({ type: row.type, count: row._count._all }))
          .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
        failedDeliveries: failed.map((row) => ({
          id: row.id,
          eventId: row.eventId,
          type: row.event.type,
          subscriberId: row.subscriberId,
          status: row.status as "failed",
          attempts: row.attempts,
          lastError: row.lastError,
          nextAttemptAt: row.nextAttemptAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null
        }))
      };
    });
  }

  /**
   * Manual replay of a dead-letter delivery (task 01.2): resets only `failed` rows to `pending`
   * with a fresh attempt budget. The next tick picks it up; the handler must still be idempotent.
   * Returns false when the row is absent, belongs to another workspace or is not failed.
   */
  async replayDelivery(deliveryId: string, workspaceId?: string): Promise<boolean> {
    return this.prisma.asSystem(async (tx) => {
      const result = await tx.domainEventDelivery.updateMany({
        where: { id: deliveryId, status: "failed", ...(workspaceId ? { workspaceId } : {}) },
        data: { status: "pending", attempts: 0, nextAttemptAt: new Date(), completedAt: null, lastError: null }
      });
      return result.count > 0;
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

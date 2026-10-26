import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { BackgroundJobsService } from "../common/background-jobs.service";
import type { Prisma } from "@prisma/client";
import { expandRecurrence, recurrenceSpecSchema } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { TelegramService } from "../notifications/telegram.service";
import { NotificationCenterService } from "../notifications/notification-center.service";
import { pluginOffWhere } from "../plugins/require-plugin";
import { NotificationPolicyService } from "../notifications/notification-policy.service";

type EventWithRelations = Prisma.EventGetPayload<{
  include: { workspace: true; overrides: true; sentReminders: true };
}>;

/**
 * The event counterpart of DueTaskCheckerService — a system-wide, cron-only
 * check (no per-user trigger) that fires each event's per-offset reminders
 * through the same TelegramService dry-run/real path. Dedup is against the
 * SentReminder ledger, not a single column, because a recurring event has
 * many occurrences (see schema comment).
 *
 * "Late is fine, ancient is not": a reminder still fires if the process was
 * down when it was due, but never for an occurrence that already started
 * more than an hour ago — matches how the task checker tolerates lateness.
 */
@Injectable()
export class EventReminderService {
  private readonly logger = new Logger(EventReminderService.name);
  private static readonly LATE_GRACE_MS = 60 * 60 * 1000;

  constructor(
    private readonly jobs: BackgroundJobsService,
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly notifications: NotificationCenterService,
    private readonly policy: NotificationPolicyService
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    await this.jobs.runJob("calendar", "event-reminders", () => this.runCheck());
  }

  async runCheck(): Promise<{ notified: number; skipped: number }> {
    const now = Date.now();
    const events = await this.prisma.asSystem((tx) =>
      tx.event.findMany({
        where: { reminders: { isEmpty: false }, workspace: { NOT: [{ disabledModules: { has: "calendar" } }, pluginOffWhere("calendar-reminders")] } },
        include: { workspace: true, overrides: true, sentReminders: true }
      })
    );

    let notified = 0;
    let skipped = 0;
    for (const event of events) {
      // Gated per event, not per reminder: an event whose owner muted event
      // reminders (or is in quiet hours) simply waits for the next tick — the
      // SentReminder ledger is only written on actual delivery, so nothing is
      // lost by skipping here.
      const recipientId = await this.policy.resolveOwnerId(event.workspaceId);
      if (!recipientId) {
        skipped += 1;
        continue;
      }
      if (!(await this.policy.allowsForUser(recipientId, "event"))) {
        skipped += 1;
        continue;
      }
      for (const { occurrenceStart, actualStart, offset } of this.dueReminders(event, now)) {
        const text = this.compose(event, actualStart, offset);
        const delivered = await this.telegram.sendMessage(text);
        await this.prisma.asSystem(async (tx) => {
          await this.notifications.createTx(tx, {
            workspaceId: event.workspaceId,
            recipientId,
            kind: "event_reminder",
            // Unique per (recipient, occurrence, offset) — belt-and-braces
            // alongside the SentReminder ledger below, which is the primary
            // dedup for recurring occurrences.
            eventKey: `event_reminder:${event.id}:${occurrenceStart.getTime()}:${offset}`,
            title: event.title,
            body: text,
            entityType: "event",
            entityId: event.id
          });
          await tx.sentReminder.create({
            data: {
              workspaceId: event.workspaceId,
              eventId: event.id,
              occurrenceStart,
              offsetMinutes: offset
            }
          });
        });
        notified++;
        if (!delivered) this.logger.warn(`Telegram delivery failed for event ${event.id}; in-app notification created`);
      }
    }
    if (notified > 0) this.logger.log(`Sent ${notified} event reminder(s)`);
    if (skipped > 0) this.logger.log(`Skipped ${skipped} event(s): отключено в настройках или тихие часы`);
    return { notified, skipped };
  }

  /** (occurrenceStart = ledger key, actualStart = post-override start, offset) triples that are due and unsent. */
  private *dueReminders(
    event: EventWithRelations,
    now: number
  ): Generator<{ occurrenceStart: Date; actualStart: Date; offset: number }> {
    if (event.reminders.length === 0) return;
    // Positive offset = before the start, negative = after (a chosen clock time).
    const latestAfterMs = Math.max(0, ...event.reminders.map((offset) => -offset)) * 60_000;
    const earliestBeforeMs = Math.max(0, ...event.reminders) * 60_000;
    const windowStart = new Date(now - EventReminderService.LATE_GRACE_MS - latestAfterMs);
    const windowEnd = new Date(now + earliestBeforeMs + 60_000);

    const originalStarts: Date[] = event.recurrence
      ? expandRecurrence(recurrenceSpecSchema.parse(event.recurrence), event.startAt, windowStart, windowEnd)
      : event.startAt >= windowStart && event.startAt <= windowEnd
        ? [event.startAt]
        : [];

    const overrideByStart = new Map(event.overrides.map((o) => [o.occurrenceStart.getTime(), o]));
    const sent = new Set(event.sentReminders.map((s) => `${s.occurrenceStart.getTime()}:${s.offsetMinutes}`));

    for (const occurrenceStart of originalStarts) {
      const ovr = overrideByStart.get(occurrenceStart.getTime());
      if (ovr?.canceled) continue;
      const actualStart = ovr?.startAt ?? occurrenceStart;
      for (const offset of event.reminders) {
        const fireAt = actualStart.getTime() - offset * 60_000;
        if (fireAt > now) continue;
        if (sent.has(`${occurrenceStart.getTime()}:${offset}`)) continue;
        // Before the start: still deliver until an hour after the event began.
        // After the start: only within an hour of the chosen clock time.
        if (offset >= 0) {
          if (actualStart.getTime() < now - EventReminderService.LATE_GRACE_MS) continue;
        } else if (fireAt < now - EventReminderService.LATE_GRACE_MS) continue;
        yield { occurrenceStart, actualStart, offset };
      }
    }
  }

  private compose(event: EventWithRelations, start: Date, offsetMinutes: number): string {
    const span = (minutes: number): string =>
      minutes % 1440 === 0 ? `${minutes / 1440} дн.` : minutes % 60 === 0 ? `${minutes / 60} ч.` : `${minutes} мин.`;
    const when =
      offsetMinutes === 0
        ? "сейчас"
        : offsetMinutes > 0
          ? `через ${span(offsetMinutes)}`
          : `спустя ${span(-offsetMinutes)}`;
    const at = event.allDay
      ? start.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })
      : start.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
    return `🔔 ${when}: ${event.title} — ${at} (пространство: ${event.workspace.name})`;
  }
}

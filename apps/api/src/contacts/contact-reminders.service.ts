import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { contactFollowUp, isoToLocalDayKey, nextBirthday } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { NotificationCenterService } from "../notifications/notification-center.service";
import { NotificationPolicyService } from "../notifications/notification-policy.service";
import { TelegramService } from "../notifications/telegram.service";

/** How many days ahead the one «скоро день рождения» heads-up goes out. */
const BIRTHDAY_HEADS_UP_DAYS = 7;

function localDayKey(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function inDays(count: number): string {
  const last = count % 10;
  const teen = count % 100 >= 11 && count % 100 <= 14;
  return `${count} ${teen ? "дней" : last === 1 ? "день" : last >= 2 && last <= 4 ? "дня" : "дней"}`;
}

/**
 * Producer of two contact notifications, both from one hourly pass:
 *
 *  - `contact_birthday` — a heads-up once, 7 days before at the latest, and one
 *    on the day itself;
 *  - `contact_followup` — «пора связаться», once for each due date, when
 *    `lastContactedAt + contactEveryDays` has come (logging a contact moves the
 *    due date and so re-arms it).
 *
 * Like every producer it asks `NotificationPolicyService` first and does not
 * mark a policy-suppressed reminder as delivered: the next hourly tick retries
 * it once quiet hours end. Dedup is the `(recipientId, eventKey)` unique index
 * through `createTx` (`createMany({ skipDuplicates: true })`), so overlapping or
 * repeated ticks never double-send. Contacts are workspace-scoped, so the
 * recipient is the workspace owner — the same stand-in the finance/inventory
 * alerts use. Archived contacts and workspaces with the module switched off are
 * left alone. The day is the server's local day: a birthday near midnight in
 * another time zone can land a few hours off — acceptable for an ambient nudge.
 */
@Injectable()
export class ContactRemindersService {
  private readonly logger = new Logger(ContactRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationCenterService,
    private readonly policy: NotificationPolicyService,
    private readonly telegram: TelegramService
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    await this.runCheck();
  }

  async runCheck(now: Date = new Date()): Promise<{ birthdays: number; followUps: number }> {
    const today = localDayKey(now);
    const candidates = await this.prisma.asSystem((tx) =>
      tx.contact.findMany({
        where: {
          archivedAt: null,
          OR: [{ birthday: { not: null } }, { contactEveryDays: { not: null } }],
          NOT: { workspace: { disabledModules: { has: "contacts" } } }
        },
        select: { id: true, workspaceId: true, name: true, birthday: true, contactEveryDays: true, lastContactedAt: true, createdAt: true, archivedAt: true }
      })
    );

    let birthdays = 0;
    let followUps = 0;
    const telegramMessages: string[] = [];
    const recipients = new Map<string, string | null>();

    for (const contact of candidates) {
      const events: { eventKey: string; kind: "contact_birthday" | "contact_followup"; title: string; body: string }[] = [];

      if (contact.birthday) {
        const birthday = nextBirthday(contact.birthday.toISOString().slice(0, 10), today);
        if (birthday) {
          const age = birthday.turning !== null ? `Исполняется ${birthday.turning}.` : "";
          if (birthday.daysUntil === 0) {
            events.push({ eventKey: `contact_birthday:${contact.id}:${birthday.date}:day`, kind: "contact_birthday", title: `Сегодня день рождения: ${contact.name}`, body: age });
          } else if (birthday.daysUntil <= BIRTHDAY_HEADS_UP_DAYS) {
            events.push({
              eventKey: `contact_birthday:${contact.id}:${birthday.date}:soon`,
              kind: "contact_birthday",
              title: `Скоро день рождения: ${contact.name}`,
              body: `Через ${inDays(birthday.daysUntil)} (${birthday.date.slice(8, 10)}.${birthday.date.slice(5, 7)}). ${age}`.trim()
            });
          }
        }
      }

      const followUp = contactFollowUp(
        {
          contactEveryDays: contact.contactEveryDays,
          lastContactedAt: contact.lastContactedAt?.toISOString() ?? null,
          createdAt: contact.createdAt.toISOString(),
          archivedAt: null
        },
        today
      );
      if (followUp && followUp.overdueDays >= 0) {
        events.push({
          eventKey: `contact_followup:${contact.id}:${followUp.dueDate}`,
          kind: "contact_followup",
          title: `Пора связаться: ${contact.name}`,
          body: contact.lastContactedAt ? `Последний контакт — ${isoToLocalDayKey(contact.lastContactedAt.toISOString())}.` : "Контакта ещё не было."
        });
      }
      if (events.length === 0) continue;

      let recipientId = recipients.get(contact.workspaceId);
      if (recipientId === undefined) {
        recipientId = await this.policy.resolveOwnerId(contact.workspaceId);
        recipients.set(contact.workspaceId, recipientId);
      }
      if (!recipientId) continue;
      if (!(await this.policy.allowsForUser(recipientId, "contact", now))) continue;

      for (const event of events) {
        const created = await this.prisma.asSystem((tx) =>
          this.notifications.createTx(tx, {
            workspaceId: contact.workspaceId,
            recipientId: recipientId as string,
            kind: event.kind,
            eventKey: event.eventKey,
            title: event.title,
            body: event.body,
            entityType: "contact",
            entityId: contact.id
          })
        );
        if (!created) continue;
        if (event.kind === "contact_birthday") birthdays += 1;
        else followUps += 1;
        telegramMessages.push(`${event.kind === "contact_birthday" ? "🎂" : "📞"} ${event.title}${event.body ? ` — ${event.body}` : ""}`);
      }
    }

    // Best-effort, after the rows are committed (same as budget/inventory alerts).
    for (const message of telegramMessages) await this.telegram.sendMessage(message);
    if (birthdays + followUps > 0) this.logger.log(`Контакты: ${birthdays} о днях рождения, ${followUps} «пора связаться»`);
    return { birthdays, followUps };
  }
}

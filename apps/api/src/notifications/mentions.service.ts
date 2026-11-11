import { Injectable } from "@nestjs/common";
import type { Notification } from "@orion/shared-types";
import { parseMentions } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { NotificationCenterService } from "./notification-center.service";
import { NotificationPolicyService, type ReminderKind } from "./notification-policy.service";

export interface MentionDeliveryInput {
  workspaceId: string;
  /** Автор текста — человек. Своё упоминание самому себе уведомления не создаёт. */
  actorId: string;
  /** Текст с `@именами`. */
  body: string;
  /** Тип и id объекта, к которому относится упоминание (`task`, `project`, …). */
  entityType: string;
  entityId: string;
  /** Человекочитаемое имя объекта для заголовка: «Упоминание в задаче: …». */
  entityLabel: string;
  /** Вид уведомления в ленте (существующий enum, чтобы не менять клиентов). */
  notificationKind: Notification["kind"];
  /** Какой тумблер/тихие часы спрашивать у получателя-человека. */
  policyKind: ReminderKind;
  /** Префикс дедупликации; полный ключ — `<prefix>:<получатель>`. */
  eventKeyPrefix: string;
  /** Кого не уведомлять дополнительно (например, исполнителя, который уже получил уведомление о комментарии). */
  excludeUserIds?: readonly string[];
  /** Заголовок уведомления без «Упоминание в …» — если у объекта своя формулировка. */
  title?: string;
}

export interface MentionDeliveryResult {
  humans: number;
  agents: number;
  /** Упомянутые имена, которым не нашлось участника этого пространства. Никому не адресуются. */
  unresolved: string[];
}

/**
 * Упоминания `@имя` (задание 12.3).
 *
 * Правила, которые здесь сознательно жёсткие:
 *  - резолв идёт ТОЛЬКО по участникам этого пространства: упомянуть постороннего нельзя, потому что
 *    его просто нет в выборке (RLS + `workspaceId` в запросе);
 *  - человек получает обычное адресное уведомление (с уважением к его тумблерам и тихим часам);
 *  - агентское членство не имеет `User`, поэтому упоминание кладётся в его очередь
 *    `AgentMemberEvent` — её читает агент/владелец через `GET /team/agents/:id/events`;
 *  - при совпадении имён у нескольких участников уведомление получают все: гадать, кто имелся в
 *    виду, нельзя, а тихо выбрать одного — значит потерять адресата.
 */
@Injectable()
export class MentionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly notifications: NotificationCenterService,
    private readonly policy: NotificationPolicyService
  ) {}

  async deliver(input: MentionDeliveryInput): Promise<MentionDeliveryResult> {
    const names = parseMentions(input.body);
    if (names.length === 0) return { humans: 0, agents: 0, unresolved: [] };
    const lowered = new Set(names.map((name) => name.toLocaleLowerCase("ru")));

    const { humans, agents, unresolved } = await this.prisma.withUser(input.actorId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, input.actorId, input.workspaceId);
      const members = await tx.workspaceMember.findMany({
        where: { workspaceId: input.workspaceId },
        select: {
          id: true,
          kind: true,
          userId: true,
          displayName: true,
          user: { select: { id: true, name: true } }
        }
      });

      const humans = new Map<string, { userId: string; name: string }>();
      const agents: Array<{ memberId: string; name: string }> = [];
      const matched = new Set<string>();
      for (const member of members) {
        const name = member.kind === "agent" ? member.displayName : member.user?.name;
        const userId = member.userId;
        if (!name || !lowered.has(name.trim().toLocaleLowerCase("ru"))) continue;
        matched.add(name.trim().toLocaleLowerCase("ru"));
        if (member.kind === "agent") agents.push({ memberId: member.id, name });
        else if (userId) humans.set(userId, { userId, name });
      }

      // Агентские упоминания пишутся в этой же транзакции, чтобы комментарий и адресованное событие
      // не разъезжались при сбое. Дедуп — по (memberId, eventKey).
      if (agents.length > 0) {
        const excerpt = excerptOf(input.body);
        await tx.agentMemberEvent.createMany({
          data: agents.map((agent) => ({
            workspaceId: input.workspaceId,
            memberId: agent.memberId,
            kind: "mention",
            title: input.title ?? `Упоминание: ${input.entityLabel}`,
            body: excerpt,
            entityType: input.entityType,
            entityId: input.entityId,
            actorUserId: input.actorId,
            eventKey: `${input.eventKeyPrefix}:${agent.memberId}`
          })),
          skipDuplicates: true
        });
      }

      return {
        humans: [...humans.values()],
        agents,
        unresolved: names.filter((name) => !matched.has(name.toLocaleLowerCase("ru")))
      };
    });

    const excluded = new Set(input.excludeUserIds ?? []);
    let delivered = 0;
    for (const human of humans) {
      if (excluded.has(human.userId) || human.userId === input.actorId) continue;
      if (!(await this.policy.allowsForUser(human.userId, input.policyKind))) continue;
      // Отдельная `asSystem`-транзакция: уведомление адресовано другому человеку, а политика
      // `notifications` разрешает вставку только получателю (см. TaskCommentsService).
      const created = await this.prisma.asSystem((tx) =>
        this.notifications.createTx(tx, {
          workspaceId: input.workspaceId,
          recipientId: human.userId,
          kind: input.notificationKind,
          eventKey: `${input.eventKeyPrefix}:${human.userId}`,
          actorId: input.actorId,
          title: input.title ?? `Упоминание: ${input.entityLabel}`,
          body: excerptOf(input.body),
          entityType: input.entityType,
          entityId: input.entityId
        })
      );
      if (created) delivered += 1;
    }

    return { humans: delivered, agents: agents.length, unresolved };
  }
}

/** Короткая выжимка текста для уведомления — не весь комментарий. */
function excerptOf(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 200 ? `${normalized.slice(0, 200)}…` : normalized;
}

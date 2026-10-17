import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  computeSplitBalances,
  type CreateSettlementInput,
  type CreateSplitInput,
  type Settlement,
  type Split,
  type SplitOverview
} from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { NotificationCenterService } from "../../notifications/notification-center.service";
import { NotificationPolicyService } from "../../notifications/notification-policy.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";

const RECENT = 100;

/**
 * A ledger between the members of one workspace. Every person named in a split or a settlement must be a member NOW
 * (checked when it is written); later departures do not erase history — ids are plain strings. The balances are
 * computed over ALL records with the same pure function the client uses to preview them, never over the capped
 * «recent» lists. Nothing here touches an account.
 */
@Injectable()
export class SplitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly notifications: NotificationCenterService,
    private readonly policy: NotificationPolicyService
  ) {}

  async overview(userId: string, workspaceId: string): Promise<SplitOverview> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const [recentSplits, recentSettlements, allSplits, allSettlements] = await Promise.all([
        tx.financeSplit.findMany({ where: { workspaceId }, include: { shares: true }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], take: RECENT }),
        tx.financeSettlement.findMany({ where: { workspaceId }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], take: RECENT }),
        tx.financeSplit.findMany({ where: { workspaceId }, select: { amount: true, currency: true, paidById: true, shares: { select: { userId: true, share: true } } } }),
        tx.financeSettlement.findMany({ where: { workspaceId }, select: { amount: true, currency: true, fromUserId: true, toUserId: true } })
      ]);
      return {
        splits: recentSplits.map(toSplitDto),
        settlements: recentSettlements.map(toSettlementDto),
        balances: computeSplitBalances(allSplits, allSettlements)
      };
    });
  }

  async createSplit(userId: string, workspaceId: string, input: CreateSplitInput): Promise<Split> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertMembers(tx, workspaceId, [input.paidById, ...input.shares.map((share) => share.userId)]);
      if (input.transactionId) {
        const operation = await tx.transaction.findUnique({ where: { id: input.transactionId }, select: { workspaceId: true } });
        if (!operation || operation.workspaceId !== workspaceId) throw new BadRequestException("Операция не найдена в этом пространстве");
      }
      return tx.financeSplit.create({
        data: {
          workspaceId,
          title: input.title,
          amount: input.amount,
          currency: input.currency,
          paidById: input.paidById,
          occurredAt: new Date(input.occurredAt),
          note: input.note,
          transactionId: input.transactionId ?? null,
          createdById: userId,
          shares: { create: input.shares.map((share) => ({ workspaceId, userId: share.userId, share: share.share })) }
        },
        include: { shares: true }
      });
    });
    await this.notifyShares(userId, workspaceId, row);
    return toSplitDto(row);
  }

  /**
   * Tell each person who now owes something. Actor-triggered, so the notification is written in its own `asSystem`
   * transaction (the recipient is not the session user — RLS would refuse it otherwise), after the expense is saved;
   * the recipient's own settings (finance toggle, quiet hours) decide, and the actor is never told about their own action.
   * A failure here must not undo or fail the expense, so it is swallowed.
   */
  private async notifyShares(actorId: string, workspaceId: string, split: SplitRow): Promise<void> {
    try {
      const names = await this.prisma.asSystem((tx) => tx.user.findMany({ where: { id: { in: [split.paidById, actorId] } }, select: { id: true, name: true } }));
      const nameOf = (id: string): string => names.find((user) => user.id === id)?.name ?? "Участник";
      for (const share of split.shares) {
        // The payer's own share is not a debt to anybody.
        if (share.userId === actorId || share.userId === split.paidById || share.share <= 0) continue;
        if (!(await this.policy.allowsForUser(share.userId, "finance"))) continue;
        await this.prisma.asSystem((tx) =>
          this.notifications.createTx(tx, {
            workspaceId,
            recipientId: share.userId,
            kind: "finance_alert",
            eventKey: `finance_split:${split.id}:${share.userId}`,
            actorId,
            title: `Общий расход: ${split.title}`,
            body: `Заплатил(а) ${nameOf(split.paidById)}. Ваша доля — ${(share.share / 100).toFixed(2)} ${split.currency}`
          })
        );
      }
    } catch {
      // The ledger is already correct; a missed notification is not worth failing the request.
    }
  }

  /** Only whoever recorded the expense, or paid it, can remove it — it changes what other people owe. */
  async removeSplit(userId: string, workspaceId: string, splitId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const split = await tx.financeSplit.findUnique({ where: { id: splitId } });
      if (!split || split.workspaceId !== workspaceId) throw new NotFoundException("Расход не найден");
      if (split.createdById !== userId && split.paidById !== userId) throw new ForbiddenException("Удалить расход может тот, кто его записал или оплатил");
      await tx.financeSplit.delete({ where: { id: splitId } });
    });
  }

  async createSettlement(userId: string, workspaceId: string, input: CreateSettlementInput): Promise<Settlement> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertMembers(tx, workspaceId, [input.fromUserId, input.toUserId]);
      return tx.financeSettlement.create({
        data: {
          workspaceId,
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          amount: input.amount,
          currency: input.currency,
          occurredAt: new Date(input.occurredAt),
          note: input.note,
          createdById: userId
        }
      });
    });
    await this.notifySettlement(userId, workspaceId, row);
    return toSettlementDto(row);
  }

  /** Both sides hear about a settlement unless they recorded it themselves (see `notifyShares`). */
  private async notifySettlement(actorId: string, workspaceId: string, settlement: SettlementRow): Promise<void> {
    try {
      const names = await this.prisma.asSystem((tx) => tx.user.findMany({ where: { id: { in: [settlement.fromUserId, settlement.toUserId] } }, select: { id: true, name: true } }));
      const nameOf = (id: string): string => names.find((user) => user.id === id)?.name ?? "Участник";
      const amount = `${(settlement.amount / 100).toFixed(2)} ${settlement.currency}`;
      for (const recipientId of [settlement.fromUserId, settlement.toUserId]) {
        if (recipientId === actorId || !(await this.policy.allowsForUser(recipientId, "finance"))) continue;
        await this.prisma.asSystem((tx) =>
          this.notifications.createTx(tx, {
            workspaceId,
            recipientId,
            kind: "finance_alert",
            eventKey: `finance_settlement:${settlement.id}:${recipientId}`,
            actorId,
            title: "Взаиморасчёт записан",
            body: `${nameOf(settlement.fromUserId)} → ${nameOf(settlement.toUserId)}: ${amount}`
          })
        );
      }
    } catch {
      // See `notifyShares`.
    }
  }

  async removeSettlement(userId: string, workspaceId: string, settlementId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const settlement = await tx.financeSettlement.findUnique({ where: { id: settlementId } });
      if (!settlement || settlement.workspaceId !== workspaceId) throw new NotFoundException("Расчёт не найден");
      if (![settlement.createdById, settlement.fromUserId, settlement.toUserId].includes(userId)) {
        throw new ForbiddenException("Удалить расчёт может тот, кто его записал, или одна из сторон");
      }
      await tx.financeSettlement.delete({ where: { id: settlementId } });
    });
  }

  private async assertMembers(tx: Prisma.TransactionClient, workspaceId: string, userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    const members = await tx.workspaceMember.findMany({ where: { workspaceId, userId: { in: unique } }, select: { userId: true } });
    if (members.length !== unique.length) throw new BadRequestException("Все участники должны состоять в этом пространстве");
  }
}

type SplitRow = {
  id: string;
  workspaceId: string;
  title: string;
  amount: number;
  currency: string;
  paidById: string;
  occurredAt: Date;
  note: string;
  transactionId: string | null;
  createdById: string;
  createdAt: Date;
  shares: { userId: string; share: number }[];
};

function toSplitDto(row: SplitRow): Split {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    amount: row.amount,
    currency: row.currency,
    paidById: row.paidById,
    occurredAt: row.occurredAt.toISOString(),
    note: row.note,
    transactionId: row.transactionId,
    createdById: row.createdById,
    shares: row.shares.map((share) => ({ userId: share.userId, share: share.share })),
    createdAt: row.createdAt.toISOString()
  };
}

type SettlementRow = {
  id: string;
  workspaceId: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
  occurredAt: Date;
  note: string;
  createdById: string;
  createdAt: Date;
};

function toSettlementDto(row: SettlementRow): Settlement {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    amount: row.amount,
    currency: row.currency,
    occurredAt: row.occurredAt.toISOString(),
    note: row.note,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString()
  };
}

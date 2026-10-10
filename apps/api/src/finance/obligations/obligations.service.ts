import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  advanceObligationDue,
  type CreateObligationInput,
  type Obligation,
  type ObligationInterval,
  type ObligationKind,
  type PayObligationInput,
  type Transaction,
  type UpdateObligationInput
} from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { assertAccountInWorkspace, assertCategoryInWorkspace } from "../finance-refs.util";

/**
 * Debts, credits, utility bills, subscriptions. An obligation is a PLAN: creating, editing or closing one never
 * touches a balance. `pay` is the only thing that does, and it does it the ordinary way — by writing a real
 * transaction into the account the payer confirms — in the same database transaction that moves the due date
 * and the remaining principal, so the plan and the ledger cannot disagree. The transaction's `importedRef`
 * (`obligation:<id>:<due date>`) is unique per workspace: paying the same due date twice (a double click, a
 * retry) is a 409, never a second expense.
 */
@Injectable()
export class ObligationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string): Promise<Obligation[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.financeObligation.findMany({ where: { workspaceId }, orderBy: [{ createdAt: "asc" }] });
    });
    return rows.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateObligationInput): Promise<Obligation> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      if (input.accountId) await assertAccountInWorkspace(tx, workspaceId, input.accountId);
      if (input.categoryId) await assertCategoryInWorkspace(tx, workspaceId, input.categoryId);
      return tx.financeObligation.create({
        data: {
          workspaceId,
          name: input.name,
          kind: input.kind,
          direction: input.direction,
          principal: input.principal ?? null,
          payment: input.payment,
          interval: input.interval,
          nextDueAt: input.nextDueAt ? new Date(input.nextDueAt) : null,
          accountId: input.accountId ?? null,
          categoryId: input.categoryId ?? null,
          note: input.note
        }
      });
    });
    return toDto(row);
  }

  async update(userId: string, workspaceId: string, obligationId: string, input: UpdateObligationInput): Promise<Obligation> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, obligationId);
      if (input.accountId) await assertAccountInWorkspace(tx, workspaceId, input.accountId);
      if (input.categoryId) await assertCategoryInWorkspace(tx, workspaceId, input.categoryId);
      const { nextDueAt, closedAt, ...rest } = input;
      return tx.financeObligation.update({
        where: { id: obligationId },
        data: {
          ...rest,
          ...(nextDueAt !== undefined ? { nextDueAt: nextDueAt ? new Date(nextDueAt) : null } : {}),
          ...(closedAt !== undefined ? { closedAt: closedAt ? new Date(closedAt) : null } : {})
        }
      });
    });
    return toDto(row);
  }

  async remove(userId: string, workspaceId: string, obligationId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, obligationId);
      // Payments already recorded stay: they are ordinary transactions of the ledger.
      await tx.financeObligation.delete({ where: { id: obligationId } });
    });
  }

  async pay(
    userId: string,
    workspaceId: string,
    obligationId: string,
    input: PayObligationInput
  ): Promise<{ obligation: Obligation; transaction: Transaction }> {
    try {
      return await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        const obligation = await this.assertOwnedTx(tx, workspaceId, obligationId);
        if (obligation.closedAt) throw new ConflictException("Обязательство закрыто — сначала откройте его заново");
        await assertAccountInWorkspace(tx, workspaceId, input.accountId);

        const type = obligation.direction === "owed" ? "income" : "expense";
        const amount = input.amount ?? obligation.payment;
        const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
        const dueKey = obligation.nextDueAt ? obligation.nextDueAt.toISOString().slice(0, 10) : `adhoc-${paidAt.getTime()}`;
        const importedRef = `obligation:${obligation.id}:${dueKey}`;

        // A category helps only when it fits the direction; otherwise the payment is simply uncategorised.
        let categoryId: string | null = null;
        if (obligation.categoryId) {
          const category = await tx.financeCategory.findUnique({ where: { id: obligation.categoryId } });
          if (category && category.workspaceId === workspaceId && category.kind === type) categoryId = category.id;
        }

        const created = await tx.transaction.create({
          data: {
            workspaceId,
            accountId: input.accountId,
            toAccountId: null,
            type,
            note: obligation.name,
            tags: [],
            importedRef,
            occurredAt: paidAt,
            lines: { create: [{ workspaceId, categoryId, amount }] }
          },
          include: { lines: true }
        });

        const remaining = obligation.principal === null ? null : Math.max(0, obligation.principal - amount);
        const next = obligation.nextDueAt ? advanceObligationDue(obligation.nextDueAt, obligation.interval as ObligationInterval) : null;
        const finished = obligation.interval === "once" || (remaining !== null && remaining === 0);
        const updated = await tx.financeObligation.update({
          where: { id: obligation.id },
          data: { principal: remaining, nextDueAt: finished ? null : next, closedAt: finished ? paidAt : null }
        });
        return {
          obligation: toDto(updated),
          transaction: {
            id: created.id,
            workspaceId: created.workspaceId,
            accountId: created.accountId,
            toAccountId: null,
            type,
            note: created.note,
            tags: created.tags,
            projectId: null,
            reconciledAt: null,
            importedRef: created.importedRef,
            occurredAt: created.occurredAt.toISOString(),
            lines: created.lines.map((line) => ({ id: line.id, categoryId: line.categoryId, amount: line.amount })),
            totalAmount: created.lines.reduce((sum, line) => sum + line.amount, 0),
            createdAt: created.createdAt.toISOString(),
            updatedAt: created.updatedAt.toISOString()
          }
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Платёж за этот срок уже записан");
      }
      throw error;
    }
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, obligationId: string) {
    const row = await tx.financeObligation.findUnique({ where: { id: obligationId } });
    if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Обязательство не найдено");
    return row;
  }
}

type ObligationRow = {
  id: string;
  workspaceId: string;
  name: string;
  kind: string;
  direction: string;
  principal: number | null;
  payment: number;
  interval: string;
  nextDueAt: Date | null;
  accountId: string | null;
  categoryId: string | null;
  note: string;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(row: ObligationRow): Obligation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    kind: row.kind as ObligationKind,
    direction: row.direction === "owed" ? "owed" : "owe",
    principal: row.principal,
    payment: row.payment,
    interval: row.interval as ObligationInterval,
    nextDueAt: row.nextDueAt?.toISOString() ?? null,
    accountId: row.accountId,
    categoryId: row.categoryId,
    note: row.note,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

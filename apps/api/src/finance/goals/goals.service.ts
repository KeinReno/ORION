import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CreateSavingsGoalInput, SavingsGoal, UpdateSavingsGoalInput } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { assertAccountInWorkspace, computeNetByAccount } from "../finance-refs.util";

/**
 * A goal is tied to one account (v0.13, chosen over a separate contribution
 * ledger) — `currentAmount` is just that account's live balance, computed
 * the same way `AccountsService.list` computes balances, via the shared
 * `computeNetByAccount`. `includeArchived` mirrors accounts/categories.
 */
@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string, includeArchived = false): Promise<SavingsGoal[]> {
    const { goals, netByAccount, accounts } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const goals = await tx.savingsGoal.findMany({
        where: { workspaceId, ...(includeArchived ? {} : { archivedAt: null }) },
        orderBy: { createdAt: "asc" }
      });
      const netByAccount = await computeNetByAccount(tx, workspaceId);
      const accounts = await tx.account.findMany({ where: { workspaceId } });
      return { goals, netByAccount, accounts };
    });
    const startingByAccount = new Map(accounts.map((a) => [a.id, a.startingBalance]));
    return goals.map((goal) =>
      toDto(goal, (startingByAccount.get(goal.accountId) ?? 0) + (netByAccount.get(goal.accountId) ?? 0))
    );
  }

  async create(userId: string, workspaceId: string, input: CreateSavingsGoalInput): Promise<SavingsGoal> {
    const { goal, currentAmount } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await assertAccountInWorkspace(tx, workspaceId, input.accountId);
      const goal = await tx.savingsGoal.create({
        data: {
          workspaceId,
          name: input.name,
          accountId: input.accountId,
          targetAmount: input.targetAmount,
          targetDate: input.targetDate ?? null
        }
      });
      const currentAmount = await currentAmountFor(tx, workspaceId, goal.accountId);
      return { goal, currentAmount };
    });
    return toDto(goal, currentAmount);
  }

  async update(
    userId: string,
    workspaceId: string,
    goalId: string,
    input: UpdateSavingsGoalInput
  ): Promise<SavingsGoal> {
    const { goal, currentAmount } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, goalId);
      if (input.accountId) await assertAccountInWorkspace(tx, workspaceId, input.accountId);
      const goal = await tx.savingsGoal.update({ where: { id: goalId }, data: input });
      const currentAmount = await currentAmountFor(tx, workspaceId, goal.accountId);
      return { goal, currentAmount };
    });
    return toDto(goal, currentAmount);
  }

  async remove(userId: string, workspaceId: string, goalId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, goalId);
      await tx.savingsGoal.delete({ where: { id: goalId } });
    });
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, goalId: string): Promise<void> {
    const goal = await tx.savingsGoal.findUnique({ where: { id: goalId } });
    if (!goal || goal.workspaceId !== workspaceId) {
      throw new NotFoundException("Цель не найдена");
    }
  }
}

async function currentAmountFor(tx: Prisma.TransactionClient, workspaceId: string, accountId: string): Promise<number> {
  const account = await tx.account.findUnique({ where: { id: accountId } });
  const netByAccount = await computeNetByAccount(tx, workspaceId);
  return (account?.startingBalance ?? 0) + (netByAccount.get(accountId) ?? 0);
}

type SavingsGoalRow = {
  id: string;
  workspaceId: string;
  name: string;
  accountId: string;
  targetAmount: number;
  targetDate: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
};

function toDto(goal: SavingsGoalRow, currentAmount: number): SavingsGoal {
  return {
    id: goal.id,
    workspaceId: goal.workspaceId,
    name: goal.name,
    accountId: goal.accountId,
    targetAmount: goal.targetAmount,
    targetDate: goal.targetDate ? goal.targetDate.toISOString() : null,
    currentAmount,
    archivedAt: goal.archivedAt ? goal.archivedAt.toISOString() : null,
    createdAt: goal.createdAt.toISOString()
  };
}

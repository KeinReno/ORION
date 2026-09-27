import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Budget, CreateBudgetInput, UpdateBudgetInput } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { assertCategoryInWorkspace, budgetSpentTx, firstOfMonth, monthRange } from "../finance-refs.util";

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  /**
   * `spent` is computed per budget (sum of that budget's category's expense
   * transactions within its month) rather than with one combined query —
   * budgets can span different months, and a personal workspace has few
   * enough of them that the N+1 here is simpler than it's worth optimising.
   */
  async list(userId: string, workspaceId: string, month?: string): Promise<Budget[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const where: Prisma.BudgetWhereInput = { workspaceId };
      const range = monthRange(month);
      if (range) where.month = range.start;
      const budgets = await tx.budget.findMany({ where, orderBy: { month: "desc" } });
      const withSpent: Budget[] = [];
      for (const budget of budgets) {
        const spent = await budgetSpentTx(tx, workspaceId, budget.categoryId, budget.month);
        withSpent.push(toDto(budget, spent));
      }
      return withSpent;
    });
  }

  async create(userId: string, workspaceId: string, input: CreateBudgetInput): Promise<Budget> {
    const month = firstOfMonth(new Date(input.month));
    try {
      const budget = await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        await assertCategoryInWorkspace(tx, workspaceId, input.categoryId);
        return tx.budget.create({
          data: { workspaceId, categoryId: input.categoryId, month, limitAmount: input.limitAmount }
        });
      });
      return toDto(budget, 0);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Бюджет для этой категории на этот месяц уже есть");
      }
      throw error;
    }
  }

  async update(userId: string, workspaceId: string, budgetId: string, input: UpdateBudgetInput): Promise<Budget> {
    const { budget, spent } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, budgetId);
      const budget = await tx.budget.update({ where: { id: budgetId }, data: input });
      const spent = await budgetSpentTx(tx, workspaceId, budget.categoryId, budget.month);
      return { budget, spent };
    });
    return toDto(budget, spent);
  }

  async remove(userId: string, workspaceId: string, budgetId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, budgetId);
      await tx.budget.delete({ where: { id: budgetId } });
    });
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, budgetId: string): Promise<void> {
    const budget = await tx.budget.findUnique({ where: { id: budgetId } });
    if (!budget || budget.workspaceId !== workspaceId) {
      throw new NotFoundException("Бюджет не найден");
    }
  }
}

type BudgetRow = { id: string; workspaceId: string; categoryId: string; month: Date; limitAmount: number };

function toDto(budget: BudgetRow, spent: number): Budget {
  return {
    id: budget.id,
    workspaceId: budget.workspaceId,
    categoryId: budget.categoryId,
    month: budget.month.toISOString(),
    limitAmount: budget.limitAmount,
    spent
  };
}

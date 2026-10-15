import { Injectable } from "@nestjs/common";
import type { CategoryBreakdownEntry, ProjectCosts } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { assertProjectInWorkspace } from "../finance-refs.util";

@Injectable()
export class ProjectCostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  /**
   * Exact totals of the operations booked to one project. Lines carry the money (a transaction is a header),
   * so income/expense are `SUM(line.amount)` grouped by the parent's type; transfers are excluded outright.
   */
  async costs(userId: string, workspaceId: string, projectId: string): Promise<ProjectCosts> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await assertProjectInWorkspace(tx, workspaceId, projectId);

      const where = { workspaceId, transaction: { projectId, type: { in: ["income", "expense"] as ("income" | "expense")[] } } };
      const [income, expense, grouped, operationCount, accounts] = await Promise.all([
        tx.transactionLine.aggregate({ where: { ...where, transaction: { ...where.transaction, type: "income" } }, _sum: { amount: true } }),
        tx.transactionLine.aggregate({ where: { ...where, transaction: { ...where.transaction, type: "expense" } }, _sum: { amount: true } }),
        tx.transactionLine.groupBy({
          by: ["categoryId"],
          where: { ...where, transaction: { ...where.transaction, type: "expense" } },
          _sum: { amount: true },
          orderBy: { _sum: { amount: "desc" } }
        }),
        tx.transaction.count({ where: { workspaceId, projectId, type: { in: ["income", "expense"] } } }),
        tx.transaction.findMany({
          where: { workspaceId, projectId, type: { in: ["income", "expense"] } },
          distinct: ["accountId"],
          select: { account: { select: { currency: true } } }
        })
      ]);

      const categoryIds = grouped.map((g) => g.categoryId).filter((id): id is string => id !== null);
      const categories = categoryIds.length ? await tx.financeCategory.findMany({ where: { id: { in: categoryIds }, workspaceId } }) : [];
      const nameById = new Map(categories.map((c) => [c.id, c.name]));
      const expenseByCategory: CategoryBreakdownEntry[] = grouped.map((g) => ({
        categoryId: g.categoryId,
        categoryName: g.categoryId ? (nameById.get(g.categoryId) ?? "Категория удалена") : "Без категории",
        amount: g._sum.amount ?? 0
      }));
      const currencies = [...new Set(accounts.map((row) => row.account.currency))];

      return {
        projectId,
        income: income._sum.amount ?? 0,
        expense: expense._sum.amount ?? 0,
        operationCount,
        expenseByCategory,
        mixedCurrencies: currencies.length > 1,
        currency: currencies.length === 1 ? currencies[0]! : null
      };
    });
  }
}

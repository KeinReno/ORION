import { ProjectFinanceReader } from "../../projects/public/project-finance-reader";
import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CategoryBreakdownEntry, ProjectCostTotals, ProjectCosts } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";

type MoneyType = "income" | "expense";

@Injectable()
export class ProjectCostsService {
  constructor(
    private readonly projects: ProjectFinanceReader,
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  /**
   * Exact totals of the operations booked to one project. Lines carry the money (a transaction is a header),
   * so income/expense are `SUM(line.amount)` grouped by the parent's type; transfers are excluded outright.
   *
   * Every sum is per account currency — kopecks of RUB and cents of USD are never added together. Prisma's
   * groupBy can't group by a relation field, so the sums run once per currency the project's operations use
   * (one or two in practice). The top-level `income`/`expense` are those of the leading currency: the project's own
   * `Project.currency` when it has operations in it, otherwise the one with the most operations (ties alphabetical).
   */
  async costs(userId: string, workspaceId: string, projectId: string): Promise<ProjectCosts> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const project = await this.projects.currencyTx(tx, workspaceId, projectId);
      if (!project) throw new BadRequestException("Проект не найден в этом рабочем пространстве");

      const moneyTypes: MoneyType[] = ["income", "expense"];
      const accounts = await tx.transaction.findMany({
        where: { workspaceId, projectId, type: { in: moneyTypes } },
        distinct: ["accountId"],
        select: { account: { select: { currency: true } } }
      });
      const currencies = [...new Set(accounts.map((row) => row.account.currency))].sort();

      const byCurrency: ProjectCostTotals[] = [];
      const expenseByCurrency = new Map<string, CategoryBreakdownEntry[]>();
      const categoryIds = new Set<string>();
      for (const currency of currencies) {
        const totals = await currencyTotalsTx(tx, workspaceId, projectId, currency);
        byCurrency.push(totals.totals);
        expenseByCurrency.set(
          currency,
          totals.categories.map((row) => {
            if (row.categoryId) categoryIds.add(row.categoryId);
            return { categoryId: row.categoryId, categoryName: "", currency, amount: row.amount };
          })
        );
      }

      const leading = leadingCurrency(byCurrency, project?.currency ?? null);
      const ordered = leading ? [...byCurrency.filter((t) => t.currency === leading), ...byCurrency.filter((t) => t.currency !== leading)] : byCurrency;

      const categories = categoryIds.size ? await tx.financeCategory.findMany({ where: { id: { in: [...categoryIds] }, workspaceId } }) : [];
      const nameById = new Map(categories.map((c) => [c.id, c.name]));
      const expenseByCategory: CategoryBreakdownEntry[] = ordered.flatMap((totals) =>
        (expenseByCurrency.get(totals.currency) ?? []).map((entry) => ({
          ...entry,
          categoryName: entry.categoryId ? (nameById.get(entry.categoryId) ?? "Категория удалена") : "Без категории"
        }))
      );
      const head = ordered[0];

      return {
        projectId,
        income: head?.income ?? 0,
        expense: head?.expense ?? 0,
        operationCount: byCurrency.reduce((sum, totals) => sum + totals.operationCount, 0),
        expenseByCategory,
        byCurrency: ordered,
        mixedCurrencies: currencies.length > 1,
        currency: head?.currency ?? null
      };
    });
  }
}

async function currencyTotalsTx(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  currency: string
): Promise<{ totals: ProjectCostTotals; categories: { categoryId: string | null; amount: number }[] }> {
  const lineWhere = (type: MoneyType): Prisma.TransactionLineWhereInput => ({ workspaceId, transaction: { projectId, type, account: { currency } } });
  const [income, expense, grouped, operationCount] = await Promise.all([
    tx.transactionLine.aggregate({ where: lineWhere("income"), _sum: { amount: true } }),
    tx.transactionLine.aggregate({ where: lineWhere("expense"), _sum: { amount: true } }),
    tx.transactionLine.groupBy({
      by: ["categoryId"],
      where: lineWhere("expense"),
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } }
    }),
    tx.transaction.count({ where: { workspaceId, projectId, type: { in: ["income", "expense"] }, account: { currency } } })
  ]);
  return {
    totals: { currency, income: income._sum.amount ?? 0, expense: expense._sum.amount ?? 0, operationCount },
    categories: grouped.map((g) => ({ categoryId: g.categoryId, amount: g._sum.amount ?? 0 }))
  };
}

/** The project's own currency when it has operations in it; otherwise the one with the most operations, ties alphabetical. */
function leadingCurrency(byCurrency: readonly ProjectCostTotals[], projectCurrency: string | null): string | null {
  if (projectCurrency && byCurrency.some((t) => t.currency === projectCurrency)) return projectCurrency;
  let best: ProjectCostTotals | null = null;
  for (const totals of byCurrency) {
    if (!best || totals.operationCount > best.operationCount) best = totals;
  }
  return best?.currency ?? null;
}

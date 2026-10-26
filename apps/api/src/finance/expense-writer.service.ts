import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { BudgetAlertsService } from "./budget-alerts.service";
import { assertAccountInWorkspace } from "./finance-refs.util";
import { FinanceExpenseWriter, type WriteExpenseInput } from "./public/expense-writer";

@Injectable()
export class FinanceExpenseCommands extends FinanceExpenseWriter {
  constructor(private readonly budgetAlerts: BudgetAlertsService) { super(); }

  async createExpenseTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    input: WriteExpenseInput
  ): Promise<{ transactionId: string; alerts: string[] }> {
    await assertAccountInWorkspace(tx, workspaceId, input.accountId);
    if (input.categoryId) {
      const category = await tx.financeCategory.findUnique({ where: { id: input.categoryId } });
      if (!category || category.workspaceId !== workspaceId) throw new BadRequestException("Категория не найдена в этом рабочем пространстве");
      if (category.kind !== "expense") throw new BadRequestException("Для расхода нужна категория расходов");
    }
    const created = await tx.transaction.create({
      data: {
        workspaceId,
        accountId: input.accountId,
        type: "expense",
        note: input.note,
        tags: input.tags ?? [],
        occurredAt: input.occurredAt,
        lines: { create: [{ workspaceId, categoryId: input.categoryId, amount: input.amountMinor }] }
      },
      include: { lines: true }
    });
    const alerts = await this.budgetAlerts.evaluate(tx, workspaceId, [input.categoryId], created.occurredAt);
    return { transactionId: created.id, alerts };
  }

  deliver(alerts: string[]): Promise<void> {
    return this.budgetAlerts.deliver(alerts);
  }
}

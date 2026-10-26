import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import type { RecordListExpenseInput, RecordListExpenseResult } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { FinanceExpenseWriter } from "../finance/public/expense-writer";
import { ListExpenseCommands } from "../lists/public/list-expense-commands";
import { ModulesService } from "../modules/modules.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/**
 * Plugin «Покупки → Финансы» (`lists-finance`): books the bought entries of a list as ONE expense.
 *
 * It owns no table — only `list_items.expenseTransactionId`. The entries' row locks serialise two windows
 * booking the same entries; an entry that already points at a transaction is refused with 409, so a sum is
 * never booked twice (the open question of ADR-0009). Ticking the entries is part of booking: a paid-for
 * entry is a bought entry.
 */
@Injectable()
export class ListsFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly lists: ListExpenseCommands,
    private readonly writer: FinanceExpenseWriter
  ) {}

  async recordExpense(userId: string, workspaceId: string, listId: string, input: RecordListExpenseInput): Promise<RecordListExpenseResult> {
    const itemIds = [...new Set(input.itemIds)];
    const { result, alerts } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "finance");
      const { name, items } = await this.lists.lockSelectionTx(tx, workspaceId, listId, itemIds);
      if (items.some((item) => item.expenseTransactionId)) {
        throw new ConflictException("По части пунктов расход уже записан");
      }

      let amountMinor = input.amountMinor;
      if (amountMinor === undefined) {
        if (items.some((item) => item.priceMinor === null)) {
          throw new BadRequestException("У части пунктов не указана цена — введите сумму чека");
        }
        amountMinor = items.reduce((sum, item) => sum + (item.priceMinor ?? 0), 0);
        if (amountMinor <= 0) throw new BadRequestException("Сумма должна быть больше нуля");
      }

      const { transactionId, alerts } = await this.writer.createExpenseTx(tx, workspaceId, {
        accountId: input.accountId,
        categoryId: input.categoryId ?? null,
        amountMinor,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        note: (input.note?.trim() || `Покупки по списку «${name}»`).slice(0, 500),
        tags: ["списки"]
      });

      const bookedItems = await this.lists.completeTx(tx, workspaceId, listId, userId, itemIds, transactionId);
      return { result: { transactionId, amountMinor, items: bookedItems }, alerts };
    });
    await this.writer.deliver(alerts);
    return result;
  }
}

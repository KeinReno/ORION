import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { isTransferPair, type MergeTransferInput, type Transaction } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";

/**
 * Merges the two halves of one transfer (an expense in one account, an income in another, as two bank statements show
 * it) into a single `transfer`. The pair is re-checked here with the same predicate the client used to propose it —
 * the client only suggests, this decides — and the swap is ONE database transaction: the transfer is written and both
 * originals are removed together, or nothing changes.
 *
 * Their import references are kept on the transfer (`mergedRefs`), so importing the same statements again does not
 * bring the absorbed rows back. Links to other records hang on the old rows and go with them.
 */
@Injectable()
export class TransferMatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async merge(userId: string, workspaceId: string, input: MergeTransferInput): Promise<Transaction> {
    const created = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      // Lock both rows: two windows merging the same pair must not both succeed.
      await tx.$queryRaw`SELECT id FROM "finance_transactions" WHERE id IN (${input.expenseId}, ${input.incomeId}) FOR UPDATE`;
      const [expense, income] = await Promise.all([
        tx.transaction.findUnique({ where: { id: input.expenseId }, include: { lines: true } }),
        tx.transaction.findUnique({ where: { id: input.incomeId }, include: { lines: true } })
      ]);
      if (!expense || expense.workspaceId !== workspaceId || !income || income.workspaceId !== workspaceId) {
        throw new NotFoundException("Операция не найдена");
      }
      const asSide = (row: typeof expense) => ({
        id: row.id,
        type: row.type,
        accountId: row.accountId,
        occurredAt: row.occurredAt.toISOString(),
        importedRef: row.importedRef,
        lines: row.lines,
        totalAmount: row.lines.reduce((sum, line) => sum + line.amount, 0)
      });
      if (!isTransferPair(asSide(expense), asSide(income))) {
        throw new ConflictException("Эти операции не похожи на две стороны одного перевода");
      }

      const amount = expense.lines[0]!.amount;
      const note = [...new Set([expense.note.trim(), income.note.trim()].filter(Boolean))].join(" · ");
      const refs = [expense.importedRef, income.importedRef, ...expense.mergedRefs, ...income.mergedRefs].filter((ref): ref is string => Boolean(ref));

      // Free the unique `importedRef` values before the transfer takes the expense's one.
      await tx.transaction.deleteMany({ where: { id: { in: [expense.id, income.id] } } });
      return tx.transaction.create({
        data: {
          workspaceId,
          accountId: expense.accountId,
          toAccountId: income.accountId,
          type: "transfer",
          note,
          tags: [...new Set([...expense.tags, ...income.tags])],
          projectId: expense.projectId ?? income.projectId,
          importedRef: expense.importedRef,
          mergedRefs: refs.filter((ref) => ref !== expense.importedRef),
          occurredAt: expense.occurredAt <= income.occurredAt ? expense.occurredAt : income.occurredAt,
          lines: { create: [{ workspaceId, categoryId: null, amount }] }
        },
        include: { lines: true }
      });
    });
    return {
      id: created.id,
      workspaceId: created.workspaceId,
      accountId: created.accountId,
      toAccountId: created.toAccountId,
      type: created.type,
      note: created.note,
      tags: created.tags,
      projectId: created.projectId,
      reconciledAt: created.reconciledAt?.toISOString() ?? null,
      importedRef: created.importedRef,
      occurredAt: created.occurredAt.toISOString(),
      lines: created.lines.map((line) => ({ id: line.id, categoryId: line.categoryId, amount: line.amount })),
      totalAmount: created.lines.reduce((sum, line) => sum + line.amount, 0),
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString()
    };
  }
}

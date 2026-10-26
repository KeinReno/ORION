import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { FinanceExpenseReader } from "./public/expense-reader";

@Injectable()
export class FinanceExpenseQueries extends FinanceExpenseReader {
  async byIds(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await tx.transaction.findMany({
      where: { workspaceId, id: { in: ids } },
      include: { account: { select: { currency: true } }, lines: { select: { amount: true } } }
    });
    return rows.map((row) => ({
      id: row.id, type: row.type, currency: row.account.currency,
      totalMinor: row.lines.reduce((sum, line) => sum + line.amount, 0),
      note: row.note, occurredAt: row.occurredAt.toISOString()
    }));
  }
}

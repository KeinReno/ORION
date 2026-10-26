import { Injectable, Module } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
/** Purpose-specific read port; no Lists controllers or commands are loaded. */
@Injectable()
export class ListExpenseReferences {
    async idsTx(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]): Promise<string[]> {
        const rows = await tx.listItem.findMany({ where: { list: { workspaceId }, expenseTransactionId: { in: ids } }, select: { expenseTransactionId: true } });
        return rows.map(row => row.expenseTransactionId!);
    }
}
@Module({ providers: [ListExpenseReferences], exports: [ListExpenseReferences] })
export class ListExpenseReferencesModule {
}

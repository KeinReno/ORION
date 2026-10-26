import { Injectable, Module } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
/** Caller supplies its original transaction/RLS context. No home/payment details. */
@Injectable()
export class HomePaymentReferences {
    async idsTx(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]): Promise<string[]> {
        const rows = await tx.homeUtilityPayment.findMany({ where: { workspaceId, transactionId: { in: ids } }, select: { transactionId: true } });
        return rows.map(row => row.transactionId);
    }
}
@Module({ providers: [HomePaymentReferences], exports: [HomePaymentReferences] })
export class HomePaymentReferencesModule {
}

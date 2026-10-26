import { Module } from "@nestjs/common";
import { TransactionReferenceQueries } from "../transaction-references.service";
import { TransactionReferences } from "./transaction-references";

@Module({ providers: [{ provide: TransactionReferences, useClass: TransactionReferenceQueries }], exports: [TransactionReferences] })
export class TransactionReferencesModule {}

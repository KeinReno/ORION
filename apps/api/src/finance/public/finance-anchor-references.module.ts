import { Module } from "@nestjs/common";
import { FinanceAnchorQueries } from "../finance-anchor-references.service";
import { FinanceAnchorReferences } from "./finance-anchor-references";

@Module({ providers: [{ provide: FinanceAnchorReferences, useClass: FinanceAnchorQueries }], exports: [FinanceAnchorReferences] })
export class FinanceAnchorReferencesModule {}

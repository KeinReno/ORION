import { Module } from "@nestjs/common";
import { FinanceOverviewQueries } from "../finance-overview-reader.service";
import { FinanceOverviewReader } from "./finance-overview-reader";

@Module({ providers: [{ provide: FinanceOverviewReader, useClass: FinanceOverviewQueries }], exports: [FinanceOverviewReader] })
export class FinanceOverviewReaderModule {}

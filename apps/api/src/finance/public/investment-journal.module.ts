import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { InvestmentJournalService } from "../investment-journal.service";
import { InvestmentJournal } from "./investment-journal";

/** Journal and fee commands only, without Finance controllers or scheduled jobs. */
@Module({ imports: [WorkspacesModule], providers: [{ provide: InvestmentJournal, useClass: InvestmentJournalService }], exports: [InvestmentJournal] })
export class InvestmentJournalModule {}

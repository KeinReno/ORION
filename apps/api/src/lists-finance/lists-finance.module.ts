import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FinanceModule } from "../finance/finance.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ListsFinanceController } from "./lists-finance.controller";
import { ListsFinanceService } from "./lists-finance.service";

/** Plugin «Покупки → Финансы» — the Lists ↔ Finance bridge; money is written only through FinanceExpenseWriter. */
@Module({
  imports: [AuthModule, WorkspacesModule, FinanceModule],
  controllers: [ListsFinanceController],
  providers: [ListsFinanceService]
})
export class ListsFinanceModule {}

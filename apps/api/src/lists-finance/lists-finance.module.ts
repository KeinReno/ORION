import { ListExpenseCommandsModule } from "../lists/public/list-expense-commands.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FinanceExpenseModule } from "../finance/public/expense.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ListsFinanceController } from "./lists-finance.controller";
import { ListsFinanceService } from "./lists-finance.service";

/** Plugin «Покупки → Финансы» — the Lists ↔ Finance bridge; money is written only through FinanceExpenseWriter. */
@Module({
  imports: [ListExpenseCommandsModule, AuthModule, WorkspacesModule, FinanceExpenseModule],
  controllers: [ListsFinanceController],
  providers: [ListsFinanceService]
})
export class ListsFinanceModule {}

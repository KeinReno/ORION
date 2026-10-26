import { Module } from "@nestjs/common";
import { NotificationsModule } from "../../notifications/notifications.module";
import { BudgetAlertsService } from "../budget-alerts.service";
import { FinanceExpenseCommands } from "../expense-writer.service";
import { FinanceExpenseQueries } from "../expense-reader.service";
import { FinanceExpenseReader } from "./expense-reader";
import { FinanceExpenseWriter } from "./expense-writer";

/** Expense bridge SDK; no finance controllers or recurring jobs. */
@Module({ imports: [NotificationsModule], providers: [BudgetAlertsService,
  { provide: FinanceExpenseReader, useClass: FinanceExpenseQueries },
  { provide: FinanceExpenseWriter, useClass: FinanceExpenseCommands }],
  exports: [FinanceExpenseReader, FinanceExpenseWriter, BudgetAlertsService] })
export class FinanceExpenseModule {}

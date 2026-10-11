import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AccountsController } from "./accounts/accounts.controller";
import { AccountsService } from "./accounts/accounts.service";
import { CategoriesController } from "./categories/categories.controller";
import { CategoriesService } from "./categories/categories.service";
import { TransactionsController } from "./transactions/transactions.controller";
import { TransactionsService } from "./transactions/transactions.service";
import { BudgetsController } from "./budgets/budgets.controller";
import { BudgetsService } from "./budgets/budgets.service";
import { RecurringController } from "./recurring/recurring.controller";
import { RecurringService } from "./recurring/recurring.service";
import { RecurringCheckerService } from "./recurring/recurring-checker.service";
import { ReportsController } from "./reports/reports.controller";
import { ReportsService } from "./reports/reports.service";
import { CategoryRulesController } from "./category-rules/category-rules.controller";
import { CategoryRulesService } from "./category-rules/category-rules.service";
import { GoalsController } from "./goals/goals.controller";
import { GoalsService } from "./goals/goals.service";
import { ObligationsController } from "./obligations/obligations.controller";
import { ObligationsService } from "./obligations/obligations.service";
import { BudgetAlertsService } from "./budget-alerts.service";

/**
 * One module for the whole "Финансы" domain (accounts/categories/
 * transactions/budgets/recurring/reports) rather than six — see
 * docs/HISTORY.md v0.8: it's one product surface (one sidebar entry, one
 * FinancePanel with tabs), so one NestJS module with several controller+
 * service pairs mirrors that, instead of splitting into module-per-entity
 * for no reason.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, NotificationsModule],
  controllers: [
    AccountsController,
    CategoriesController,
    TransactionsController,
    BudgetsController,
    RecurringController,
    ReportsController,
    CategoryRulesController,
    GoalsController,
    ObligationsController
  ],
  providers: [
    AccountsService,
    CategoriesService,
    TransactionsService,
    BudgetsService,
    RecurringService,
    RecurringCheckerService,
    ReportsService,
    CategoryRulesService,
    GoalsService,
    ObligationsService,
    BudgetAlertsService
  ]
})
export class FinanceModule {}

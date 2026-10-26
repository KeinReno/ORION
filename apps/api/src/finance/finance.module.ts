import { AgentDraftOperationsModule } from "./public/agent-draft-operations.module";
import { ProjectReferencesModule } from "../projects/public/project-references.module";
import { ProjectFinanceReaderModule } from "../projects/public/project-finance-reader.module";
import { AgentCoreModule } from "../ai/agent-core.module";
import { FinanceAgentController } from "./finance.agent.controller";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AccountsController } from "./accounts/accounts.controller";
import { AccountsService } from "./accounts/accounts.service";
import { CategoriesController } from "./categories/categories.controller";
import { CategoriesService } from "./categories/categories.service";
import { TransactionsController } from "./transactions/transactions.controller";
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
import { ProjectCostsController } from "./project-costs/project-costs.controller";
import { ProjectCostsService } from "./project-costs/project-costs.service";
import { TransferMatchController } from "./transfer-match/transfer-match.controller";
import { TransferMatchService } from "./transfer-match/transfer-match.service";
import { TemplatesController } from "./templates/templates.controller";
import { TemplatesService } from "./templates/templates.service";
import { SplitsController } from "./splits/splits.controller";
import { SplitsService } from "./splits/splits.service";
import { ExchangeRatesController } from "./exchange-rates/exchange-rates.controller";
import { ExchangeRatesService } from "./exchange-rates/exchange-rates.service";
import { FinanceDraftsController } from "./drafts/finance-drafts.controller";
import { FinanceExpenseModule } from "./public/expense.module";
import { SearchRegistryModule } from "../search/search-registry.module";
import { TransactionsSearchProvider, AccountsSearchProvider, SavingsGoalsSearchProvider } from "./finance-search.providers";
import { FinanceProjectAggregates } from "./finance-project-aggregates";

/**
 * One module for the whole "Финансы" domain (accounts/categories/
 * transactions/budgets/recurring/reports) rather than six — see
 * docs/HISTORY.md v0.8: it's one product surface (one sidebar entry, one
 * FinancePanel with tabs), so one NestJS module with several controller+
 * service pairs mirrors that, instead of splitting into module-per-entity
 * for no reason.
 */
@Module({
  imports: [AgentDraftOperationsModule, FinanceExpenseModule, ProjectReferencesModule, ProjectFinanceReaderModule, AuthModule, WorkspacesModule, NotificationsModule, SearchRegistryModule, AgentCoreModule],
  controllers: [
    FinanceAgentController,
    AccountsController,
    CategoriesController,
    TransactionsController,
    BudgetsController,
    RecurringController,
    ReportsController,
    CategoryRulesController,
    GoalsController,
    ObligationsController,
    ProjectCostsController,
    TransferMatchController,
    TemplatesController,
    SplitsController,
    ExchangeRatesController,
    FinanceDraftsController
  ],
  providers: [
    FinanceProjectAggregates,
    AccountsService,
    CategoriesService,
    BudgetsService,
    RecurringService,
    RecurringCheckerService,
    ReportsService,
    CategoryRulesService,
    GoalsService,
    ObligationsService,
    ProjectCostsService,
    TransferMatchService,
    TemplatesService,
    SplitsService,
    ExchangeRatesService,
    TransactionsSearchProvider, AccountsSearchProvider, SavingsGoalsSearchProvider
  ],
  exports: [FinanceExpenseModule, AgentDraftOperationsModule]
})
export class FinanceModule {}

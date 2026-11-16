import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { ProjectReferencesModule } from "../../projects/public/project-references.module";
import { FinanceExpenseModule } from "./expense.module";
import { TransactionsService } from "../transactions/transactions.service";
import { FinanceSettingsService } from "../finance-settings.service";
import { FinanceDraftsService } from "../drafts/finance-drafts.service";
import { AgentDraftOperations } from "./agent-draft-operations";

/** Shared services without finance controllers, recurring or search registrations. */
@Module({ imports: [WorkspacesModule, ProjectReferencesModule, FinanceExpenseModule],
  providers: [TransactionsService, FinanceSettingsService, FinanceDraftsService,
    { provide: AgentDraftOperations, useFactory: (service: FinanceDraftsService): AgentDraftOperations => service, inject: [FinanceDraftsService] }],
  exports: [AgentDraftOperations, FinanceDraftsService, TransactionsService] })
export class AgentDraftOperationsModule {}

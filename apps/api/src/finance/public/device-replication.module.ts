import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { PluginsModule } from "../../plugins/plugins.module";
import { AgentDraftOperationsModule } from "./agent-draft-operations.module";
import { FinanceExpenseModule } from "./expense.module";
import { FinanceDeviceReplication } from "./device-replication";
import { FinanceDeviceReplicationService } from "../device-replication.service";
import { ListExpenseReferencesModule } from "../../lists/public/expense-references.module";
import { HomePaymentReferencesModule } from "../../home-utilities/public/payment-references.module";
@Module({ imports: [WorkspacesModule, PluginsModule, AgentDraftOperationsModule, FinanceExpenseModule, ListExpenseReferencesModule, HomePaymentReferencesModule],
    providers: [{ provide: FinanceDeviceReplication, useClass: FinanceDeviceReplicationService }], exports: [FinanceDeviceReplication] })
export class FinanceDeviceReplicationModule {
}

import { AgentCoreModule } from "../ai/agent-core.module";
import { ListsAgentController } from "./lists.agent.controller";
import { InventoryReferencesModule } from "../inventory/public/inventory-references.module";
import { TransactionReferencesModule } from "../finance/public/transaction-references.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ListsController } from "./lists.controller";
import { ListsService } from "./lists.service";
import { SearchRegistryModule } from "../search/search-registry.module";
import { ListsSearchProvider } from "./lists-search.provider";

/** ORION «Списки» — one controller/service pair, like habits/ or time/. */
@Module({
  imports: [InventoryReferencesModule, TransactionReferencesModule, AuthModule, WorkspacesModule, SearchRegistryModule, AgentCoreModule],
  controllers: [ListsController, ListsAgentController],
  providers: [ListsService, ListsSearchProvider]
})
export class ListsModule {}

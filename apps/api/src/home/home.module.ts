import { TaskHomeLinksModule } from "../tasks/public/task-home-links.module";
import { ListHomeLinksModule } from "../lists/public/list-home-links.module";
import { InventoryHomeLinksModule } from "../inventory/public/inventory-home-links.module";
import { ObligationHomeLinksModule } from "../finance/public/obligation-home-links.module";
import { TaskJournalReaderModule } from "../tasks/public/task-journal-reader.module";
import { TaskTimeReaderModule } from "../time/public/task-time-reader.module";
import { HomeContactCommandsModule } from "../contacts/public/home-contact-commands.module";
import { AgentCoreModule } from "../ai/agent-core.module";
import { HomeAgentController } from "./home.agent.controller";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModulesModule } from "../modules/modules.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { HomeController } from "./home.controller";
import { HomeService } from "./home.service";

@Module({
  imports: [TaskHomeLinksModule, ListHomeLinksModule, InventoryHomeLinksModule, ObligationHomeLinksModule, TaskJournalReaderModule, TaskTimeReaderModule, HomeContactCommandsModule, AuthModule, WorkspacesModule, ModulesModule, AgentCoreModule],
  controllers: [HomeAgentController, HomeController],
  providers: [HomeService]
})
export class HomeModule {}

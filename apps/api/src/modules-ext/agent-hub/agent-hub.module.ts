import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { ModulesModule } from "../../modules/modules.module";
import { TaskIntegrationReaderModule } from "../../tasks/public/task-integration-reader.module";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { AgentHubController } from "./agent-hub.controller";
import { AgentHubService } from "./agent-hub.service";

/** Optional agent coordination records, powered by existing platform services. */
@Module({
  imports: [AuthModule, ModulesModule, TaskIntegrationReaderModule, WorkspacesModule],
  controllers: [AgentHubController],
  providers: [AgentHubService]
})
export class AgentHubModule {}

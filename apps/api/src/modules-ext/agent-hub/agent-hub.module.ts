import { Module } from "@nestjs/common";
import { AgentCoreModule } from "../../ai/agent-core.module";
import { AuthModule } from "../../auth/auth.module";
import { ModulesModule } from "../../modules/modules.module";
import { TaskIntegrationReaderModule } from "../../tasks/public/task-integration-reader.module";
import { TaskAgentAssignmentRegistryModule } from "../../tasks/public/task-agent-assignment-registry";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { AgentHubRuntimeRegistryService } from "./agent-hub-runtime-registry.service";
import { AgentHubAgentController } from "./agent-hub.agent.controller";
import { AgentHubWorkerService } from "./agent-hub-worker.service";
import { AgentHubController } from "./agent-hub.controller";
import { AgentHubService } from "./agent-hub.service";
import { AgentHubAssignmentService } from "./agent-hub-assignment.service";
import { AgentHubTaskAssignmentBridge } from "./agent-hub-task-assignment-bridge";

/** Optional agent coordination records, powered by existing platform services. */
@Module({
  imports: [AuthModule, AgentCoreModule, ModulesModule, TaskIntegrationReaderModule, TaskAgentAssignmentRegistryModule, WorkspacesModule],
  controllers: [AgentHubController, AgentHubAgentController],
  providers: [AgentHubService, AgentHubWorkerService, AgentHubRuntimeRegistryService, AgentHubAssignmentService, AgentHubTaskAssignmentBridge]
})
export class AgentHubModule {}

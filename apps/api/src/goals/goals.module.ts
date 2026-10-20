import { AgentCoreModule } from "../ai/agent-core.module";
import { GoalsAgentController } from "./goals.agent.controller";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProjectsModule } from "../projects/projects.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { GoalsController } from "./goals.controller";
import { GoalsService } from "./goals.service";
import { SearchRegistryModule } from "../search/search-registry.module";
import { GoalsSearchProvider } from "./goals-search.provider";

@Module({
  imports: [AuthModule, WorkspacesModule, ProjectsModule, SearchRegistryModule, AgentCoreModule],
  controllers: [GoalsAgentController, GoalsController],
  providers: [GoalsService, GoalsSearchProvider]
})
export class GoalsModule {}

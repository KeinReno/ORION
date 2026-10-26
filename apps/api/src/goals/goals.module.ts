import { AgentCoreModule } from "../ai/agent-core.module";
import { GoalsAgentController } from "./goals.agent.controller";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProjectCatalogModule } from "../projects/public/project-catalog.module";
import { ProjectReferencesModule } from "../projects/public/project-references.module";
import { GoalTaskReaderModule } from "../tasks/public/goal-task-reader.module";
import { GoalMilestoneReaderModule } from "../milestones/public/goal-milestone-reader.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { GoalsController } from "./goals.controller";
import { GoalsService } from "./goals.service";
import { SearchRegistryModule } from "../search/search-registry.module";
import { GoalsSearchProvider } from "./goals-search.provider";

@Module({
  imports: [AuthModule, WorkspacesModule, ProjectCatalogModule, ProjectReferencesModule, GoalTaskReaderModule, GoalMilestoneReaderModule, SearchRegistryModule, AgentCoreModule],
  controllers: [GoalsAgentController, GoalsController],
  providers: [GoalsService, GoalsSearchProvider]
})
export class GoalsModule {}

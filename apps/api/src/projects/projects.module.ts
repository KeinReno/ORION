import { AgentCoreModule } from "../ai/agent-core.module";
import { ProjectsAgentController } from "./projects.agent.controller";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CapturesModule } from "../captures/captures.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TasksModule } from "../tasks/tasks.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ProjectCapturesService } from "./project-captures.service";
import { ProjectIdeasController, ProjectProblemsController } from "./project-captures.controller";
import { ProjectUpdatesController } from "./project-updates.controller";
import { ProjectUpdatesService } from "./project-updates.service";
import { ProjectsController } from "./projects.controller";
import { ProjectCatalogModule } from "./public/project-catalog.module";
import { SearchRegistryModule } from "../search/search-registry.module";
import { ProjectsSearchProvider } from "./projects-search.provider";

@Module({
  imports: [ProjectCatalogModule, AuthModule, WorkspacesModule, NotificationsModule, TasksModule, CapturesModule, SearchRegistryModule, AgentCoreModule],
  controllers: [ProjectsAgentController, ProjectsController, ProjectUpdatesController, ProjectIdeasController, ProjectProblemsController],
  providers: [ProjectUpdatesService, ProjectCapturesService, ProjectsSearchProvider],
  exports: [ProjectCatalogModule]
})
export class ProjectsModule {}

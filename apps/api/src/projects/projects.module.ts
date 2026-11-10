import { AgentCoreModule } from "../ai/agent-core.module";
import { TaskReferenceReaderModule } from "../tasks/public/task-reference-reader.module";
import { ProjectsAgentController } from "./projects.agent.controller";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CaptureOperationsModule } from "../captures/public/capture-operations.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ProjectCapturesService } from "./project-captures.service";
import { ProjectIdeasController, ProjectProblemsController } from "./project-captures.controller";
import { ProjectUpdatesController } from "./project-updates.controller";
import { ProjectUpdatesService } from "./project-updates.service";
import { ProjectLogbookController, ProjectRelationsController } from "./project-logbook.controller";
import { ProjectLogbookService } from "./project-logbook.service";
import { ProjectsController } from "./projects.controller";
import { ProjectCatalogModule } from "./public/project-catalog.module";
import { SearchRegistryModule } from "../search/search-registry.module";
import { ProjectsSearchProvider } from "./projects-search.provider";

@Module({
  imports: [ProjectCatalogModule, TaskReferenceReaderModule, AuthModule, WorkspacesModule, NotificationsModule, CaptureOperationsModule, SearchRegistryModule, AgentCoreModule],
  controllers: [ProjectsAgentController, ProjectsController, ProjectUpdatesController, ProjectIdeasController, ProjectProblemsController, ProjectLogbookController, ProjectRelationsController],
  providers: [ProjectUpdatesService, ProjectCapturesService, ProjectLogbookService, ProjectsSearchProvider],
  exports: [ProjectCatalogModule]
})
export class ProjectsModule {}

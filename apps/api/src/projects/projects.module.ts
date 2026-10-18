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
import { ProjectsService } from "./projects.service";
import { SearchRegistryModule } from "../search/search-registry.module";
import { ProjectsSearchProvider } from "./projects-search.provider";

@Module({
  imports: [AuthModule, WorkspacesModule, NotificationsModule, TasksModule, CapturesModule, SearchRegistryModule],
  controllers: [ProjectsController, ProjectUpdatesController, ProjectIdeasController, ProjectProblemsController],
  providers: [ProjectsService, ProjectUpdatesService, ProjectCapturesService, ProjectsSearchProvider],
  exports: [ProjectsService]
})
export class ProjectsModule {}

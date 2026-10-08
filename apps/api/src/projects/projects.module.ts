import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ProjectUpdatesController } from "./project-updates.controller";
import { ProjectUpdatesService } from "./project-updates.service";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [ProjectsController, ProjectUpdatesController],
  providers: [ProjectsService, ProjectUpdatesService],
  exports: [ProjectsService]
})
export class ProjectsModule {}

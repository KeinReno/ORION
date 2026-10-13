import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProjectsModule } from "../projects/projects.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { GoalsController } from "./goals.controller";
import { GoalsService } from "./goals.service";

@Module({
  imports: [AuthModule, WorkspacesModule, ProjectsModule],
  controllers: [GoalsController],
  providers: [GoalsService]
})
export class GoalsModule {}

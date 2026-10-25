import { ProjectReferencesModule } from "../projects/public/project-references.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { MilestonesController } from "./milestones.controller";
import { MilestonesService } from "./milestones.service";
import { MilestonesProjectAggregates } from "./milestones-project-aggregates";

/** ORION v0.27 «План проекта» — вехи и их зависимости. */
@Module({
  imports: [ProjectReferencesModule, AuthModule, WorkspacesModule],
  controllers: [MilestonesController],
  providers: [MilestonesProjectAggregates, MilestonesService]
})
export class MilestonesModule {}

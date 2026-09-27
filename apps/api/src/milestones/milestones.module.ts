import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { MilestonesController } from "./milestones.controller";
import { MilestonesService } from "./milestones.service";

/** ORION v0.27 «План проекта» — вехи и их зависимости. */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [MilestonesController],
  providers: [MilestonesService]
})
export class MilestonesModule {}

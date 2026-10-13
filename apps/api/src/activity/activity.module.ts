import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModulesModule } from "../modules/modules.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ActivityController } from "./activity.controller";
import { ActivityService } from "./activity.service";

@Module({
  imports: [AuthModule, WorkspacesModule, ModulesModule],
  controllers: [ActivityController],
  providers: [ActivityService]
})
export class ActivityModule {}

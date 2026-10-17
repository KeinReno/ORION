import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AssistantModule } from "../opportunities-assistant/public";
import { ExecutionModule } from "../opportunities-execution/public";
import { OpportunitiesModule } from "../opportunities/public";
import { ProfilesModule } from "../opportunities-profiles/public";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ManagerController } from "./manager.controller";
import { ManagerService } from "./manager.service";

@Module({ imports: [AuthModule, WorkspacesModule, OpportunitiesModule, ProfilesModule, AssistantModule, ExecutionModule], controllers: [ManagerController], providers: [ManagerService] })
export class ManagerModule {}

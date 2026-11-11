import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";
import { WorkspaceInvitesController, InviteAcceptController } from "./invites.controller";
import { WorkspaceInvitesService } from "./invites.service";
import { WorkspaceMembersController } from "./members.controller";
import { WorkspaceMembersService } from "./members.service";
import { WorkspaceTeamController } from "./team.controller";

@Module({
  imports: [AuthModule],
  controllers: [WorkspacesController, WorkspaceInvitesController, InviteAcceptController, WorkspaceMembersController, WorkspaceTeamController],
  providers: [WorkspacesService, WorkspaceInvitesService, WorkspaceMembersService],
  exports: [WorkspacesService]
})
export class WorkspacesModule {}

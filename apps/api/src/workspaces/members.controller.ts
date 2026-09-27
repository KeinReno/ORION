import { Body, Controller, Delete, Get, Param, Patch, UseGuards } from "@nestjs/common";
import {
  updateWorkspaceMemberRoleInputSchema,
  type UpdateWorkspaceMemberRoleInput,
  type WorkspaceMember
} from "@orion/shared-types";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { WorkspaceMembersService } from "./members.service";

@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/members")
export class WorkspaceMembersController {
  constructor(private readonly members: WorkspaceMembersService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<WorkspaceMember[]> {
    return this.members.list(user.userId, workspaceId);
  }

  @Patch(":memberId")
  setRole(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("memberId") memberId: string,
    @Body(new ZodValidationPipe(updateWorkspaceMemberRoleInputSchema)) body: UpdateWorkspaceMemberRoleInput
  ): Promise<WorkspaceMember> {
    return this.members.setRole(user.userId, workspaceId, memberId, body.role);
  }

  @Delete(":memberId")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("memberId") memberId: string
  ): Promise<void> {
    return this.members.remove(user.userId, workspaceId, memberId);
  }
}

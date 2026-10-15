import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
  createWorkspaceInviteInputSchema,
  type CreateWorkspaceInviteInput,
  type CreatedWorkspaceInvite,
  type InviteLookup,
  type WorkspaceInvite
} from "@orion/shared-types";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { WorkspaceInvitesService } from "./invites.service";

@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/invites")
export class WorkspaceInvitesController {
  constructor(private readonly invites: WorkspaceInvitesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<WorkspaceInvite[]> {
    return this.invites.list(user.userId, workspaceId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createWorkspaceInviteInputSchema)) body: CreateWorkspaceInviteInput
  ): Promise<CreatedWorkspaceInvite> {
    return this.invites.create(user.userId, workspaceId, body.email, body.role);
  }

  @Delete(":inviteId")
  revoke(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("inviteId") inviteId: string
  ): Promise<void> {
    return this.invites.revoke(user.userId, workspaceId, inviteId);
  }
}

/**
 * Not workspace-scoped (invariant #1 is deliberately broken here, same as
 * the calendar's `.ics` feed route) — the caller has no membership in the
 * target workspace yet, that's the whole point of the invite.
 */
@Controller("invites")
export class InviteAcceptController {
  constructor(private readonly invites: WorkspaceInvitesService) {}

  /**
   * Deliberately public (no JwtAuthGuard) — see InviteLookup's doc comment.
   * A brand-new user clicks the invite link while logged out, and the
   * accept screen needs the workspace/inviter name before they can log in
   * or register, so this can't require a session.
   */
  @Get(":token")
  lookup(@Param("token") token: string): Promise<InviteLookup> {
    return this.invites.lookup(token);
  }

  @UseGuards(JwtAuthGuard)
  @Post(":token/accept")
  accept(@CurrentUser() user: RequestUser, @Param("token") token: string): Promise<void> {
    return this.invites.accept(user.userId, user.email, token);
  }
}

import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createGrantInputSchema, type CreateGrantInput, type CrossWorkspaceGrant, type SharedGrantIssued } from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { SharedGrantsService } from "./shared-grants.service";

/**
 * Ordinary `workspaces/:workspaceId/...` controller (module contract
 * invariant #1) — issuing/revoking a grant IS a workspace-scoped action by
 * its owner, unlike reading through the grant (`SharedController`). No
 * `@RequireModule` here: sharing isn't tied to any one domain module's
 * enable/disable state — just `JwtAuthGuard` (`assertMemberRoleTx`/
 * `assertMemberTx` inside the service do the actual workspace/role gate).
 */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/grants")
export class GrantsController {
  constructor(private readonly grants: SharedGrantsService) {}

  /** Grants issued FROM this workspace — owner's own "кому я дал доступ" list. */
  @Get()
  listForWorkspace(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<SharedGrantIssued[]> {
    return this.grants.listForWorkspace(user.userId, workspaceId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createGrantInputSchema)) body: CreateGrantInput
  ): Promise<CrossWorkspaceGrant> {
    return this.grants.create(user.userId, workspaceId, body);
  }

  @Delete(":grantId")
  revoke(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("grantId") grantId: string
  ): Promise<void> {
    return this.grants.revoke(user.userId, workspaceId, grantId);
  }
}

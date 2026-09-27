import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { ResolveUserByEmailResult } from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import type { RequestUser } from "../auth/jwt.strategy";
import { UsersService } from "./users.service";

/**
 * R29-05 — see `UsersService.resolveByEmail` for the full rationale.
 * `JwtAuthGuard`-only (any authenticated user, not workspace-scoped): a
 * grant's recipient is by definition someone the caller doesn't share a
 * workspace with yet, so there's no `workspaces/:id/...` prefix to hang
 * this off (module contract invariant #1 doesn't apply — this isn't a
 * domain module's resource).
 */
@UseGuards(JwtAuthGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get("resolve-by-email")
  resolveByEmail(@CurrentUser() user: RequestUser, @Query("email") email: string | undefined): Promise<ResolveUserByEmailResult> {
    return this.users.resolveByEmail(user.userId, email ?? "");
  }
}

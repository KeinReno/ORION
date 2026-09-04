import { Controller, Get, UseGuards } from "@nestjs/common";
import type { Workspace } from "@orion/shared-types";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { WorkspacesService } from "./workspaces.service";

@UseGuards(JwtAuthGuard)
@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get("me")
  listMine(@CurrentUser() user: RequestUser): Promise<Workspace[]> {
    return this.workspaces.listForUser(user.userId);
  }
}

import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import type { AgentConnectionInfo } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { resolveAgentConnection } from "./agent-connection";

/** "Подключить агента": the real command and paths of this install, for a member who is about to issue a token. */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/agent-connection")
export class AgentConnectionController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  async info(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<AgentConnectionInfo> {
    await this.workspaces.assertMember(user.userId, workspaceId);
    return resolveAgentConnection();
  }
}

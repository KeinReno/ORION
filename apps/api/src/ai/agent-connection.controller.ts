import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { installAgentClientInputSchema, type AgentConnectionInfo, type InstallAgentClientInput, type InstalledAgentClient } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { LoopbackOnlyGuard } from "../lan/lan.controller";
import { JsonBodyGuard } from "../updates/updates.controller";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { AgentClientInstallService } from "./agent-client-install.service";
import { resolveAgentConnection } from "./agent-connection";

/** "Подключить агента": the real command and paths of this install, for a member who is about to issue a token. */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/agent-connection")
export class AgentConnectionController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly installer: AgentClientInstallService
  ) {}

  @Get()
  async info(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<AgentConnectionInfo> {
    await this.workspaces.assertMember(user.userId, workspaceId);
    return resolveAgentConnection();
  }

  /**
   * «Подключить в один клик»: writes ORION into the program's MCP config on this computer. It changes a file outside
   * ORION, so only from this computer (`LoopbackOnlyGuard`) and only as JSON (`JsonBodyGuard`, a foreign page cannot
   * post a form here).
   */
  @UseGuards(LoopbackOnlyGuard, JsonBodyGuard)
  @Post("install")
  @HttpCode(200)
  async install(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(installAgentClientInputSchema)) body: InstallAgentClientInput
  ): Promise<InstalledAgentClient> {
    await this.workspaces.assertMember(user.userId, workspaceId);
    return this.installer.install(user.userId, workspaceId, body);
  }
}

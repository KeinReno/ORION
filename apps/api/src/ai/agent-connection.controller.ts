import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  installAgentClientInputSchema,
  setAiBridgeOverrideInputSchema,
  type AgentConnectionInfo,
  type InstallAgentClientInput,
  type InstalledAgentClient,
  type SetAiBridgeOverrideInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { LoopbackOnlyGuard } from "../lan/lan.controller";
import { loadNodeConfig, saveNodeConfig } from "../lan/node-config";
import { JsonBodyGuard } from "../updates/updates.controller";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { aiBridgeOverrideEditableBy } from "./agent-tokens.service";
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
    return resolveAgentConnection({ userId: user.userId });
  }

  /**
   * ORION-12: the owner's explicit choice, overriding the mode/env default either way — not a
   * control any workspace member can touch, so it is gated the same way as the LAN host's own
   * sensitive settings (`LanController.rename`/`firewall`/…): loopback-only, and only the node's
   * recorded owner (or anyone on a fresh node with none yet — `aiBridgeOverrideEditableBy`).
   */
  @UseGuards(LoopbackOnlyGuard)
  @Patch("bridge")
  async setBridgeOverride(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(setAiBridgeOverrideInputSchema)) body: SetAiBridgeOverrideInput
  ): Promise<AgentConnectionInfo> {
    await this.workspaces.assertMember(user.userId, workspaceId);
    if (!aiBridgeOverrideEditableBy(user.userId)) throw new ForbiddenException("Узлом управляет его владелец");
    const config = loadNodeConfig();
    saveNodeConfig({ ...config, aiBridgeOverride: body.override });
    return resolveAgentConnection({ userId: user.userId });
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

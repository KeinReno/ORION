import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import {
  setWorkspacePluginInputSchema,
  type SetWorkspacePluginInput,
  type WorkspacePluginState
} from "@orion/shared-types";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { PluginsService } from "./plugins.service";

@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/plugins")
export class PluginsController {
  constructor(private readonly plugins: PluginsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string
  ): Promise<WorkspacePluginState[]> {
    return this.plugins.list(user.userId, workspaceId);
  }

  @Patch(":pluginId")
  setEnabled(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("pluginId") pluginId: string,
    @Body(new ZodValidationPipe(setWorkspacePluginInputSchema)) body: SetWorkspacePluginInput
  ): Promise<WorkspacePluginState[]> {
    return this.plugins.setEnabled(user.userId, workspaceId, pluginId, body.enabled, body.confirm === true);
  }
}

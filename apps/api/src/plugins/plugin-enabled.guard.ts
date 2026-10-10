import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { OrionPluginId } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { PluginsService } from "./plugins.service";

export const REQUIRE_PLUGIN_KEY = "orion:require-plugin";

/** 409 when the plugin this endpoint belongs to is off in the workspace (or its host module is). */
@Injectable()
export class PluginEnabledGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly plugins: PluginsService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const pluginId = this.reflector.getAllAndOverride<OrionPluginId>(REQUIRE_PLUGIN_KEY, [context.getHandler(), context.getClass()]);
    if (!pluginId) return true;
    const request = context.switchToHttp().getRequest<{ params?: { workspaceId?: string }; user?: RequestUser }>();
    const workspaceId = request.params?.workspaceId;
    const userId = request.user?.userId;
    if (!workspaceId || !userId) return true;
    await this.plugins.assertEnabled(userId, workspaceId, pluginId);
    return true;
  }
}

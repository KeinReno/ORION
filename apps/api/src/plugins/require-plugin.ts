import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import type { OrionPluginId } from "@orion/shared-types";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { PluginEnabledGuard, REQUIRE_PLUGIN_KEY } from "./plugin-enabled.guard";

/**
 * Marks an endpoint (or a whole controller) as the server side of one plugin: with the plugin off the API answers
 * 409 instead of acting, the same way `RequireModule` does for a module. Data is never touched by switching it off.
 */
export function RequirePlugin(id: OrionPluginId) {
  return applyDecorators(SetMetadata(REQUIRE_PLUGIN_KEY, id), UseGuards(JwtAuthGuard, PluginEnabledGuard));
}

/**
 * Prisma `where` fragment for background jobs (which run across workspaces): workspaces where `id` is switched OFF.
 * Plugins that are on by default are off exactly when their id is listed in `pluginOverrides`.
 */
export function pluginOffWhere(id: OrionPluginId): { pluginOverrides: { has: string } } {
  return { pluginOverrides: { has: id } };
}

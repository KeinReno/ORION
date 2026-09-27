import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import type { OrionModuleId } from "@orion/shared-types";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ModuleEnabledGuard, REQUIRE_MODULE_KEY } from "./module-enabled.guard";

/**
 * Marks a workspace-scoped controller as belonging to one domain module.
 * JwtAuthGuard runs first so `request.user` exists when ModuleEnabledGuard
 * checks `disabledModules`. A 409 is thrown if the owner turned the module off.
 */
export function RequireModule(id: OrionModuleId) {
  return applyDecorators(SetMetadata(REQUIRE_MODULE_KEY, id), UseGuards(JwtAuthGuard, ModuleEnabledGuard));
}

import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { OrionModuleId } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { ModulesService } from "./modules.service";

export const REQUIRE_MODULE_KEY = "orion:require-module";

@Injectable()
export class ModuleEnabledGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly modules: ModulesService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const moduleId = this.reflector.getAllAndOverride<OrionModuleId>(REQUIRE_MODULE_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!moduleId) return true;

    const request = context.switchToHttp().getRequest<{
      params?: { workspaceId?: string };
      user?: RequestUser;
    }>();
    const workspaceId = request.params?.workspaceId;
    const userId = request.user?.userId;
    if (!workspaceId || !userId) return true;

    await this.modules.assertEnabled(userId, workspaceId, moduleId);
    return true;
  }
}

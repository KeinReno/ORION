import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import {
  setWorkspaceModuleInputSchema,
  setWorkspaceModuleRestrictionInputSchema,
  type SetWorkspaceModuleInput,
  type SetWorkspaceModuleRestrictionInput,
  type WorkspaceModuleState
} from "@orion/shared-types";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { ModulesService } from "./modules.service";

@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/modules")
export class ModulesController {
  constructor(private readonly modules: ModulesService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string
  ): Promise<WorkspaceModuleState[]> {
    return this.modules.list(user.userId, workspaceId);
  }

  @Patch(":moduleId")
  setEnabled(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("moduleId") moduleId: string,
    @Body(new ZodValidationPipe(setWorkspaceModuleInputSchema)) body: SetWorkspaceModuleInput
  ): Promise<WorkspaceModuleState[]> {
    return this.modules.setEnabled(user.userId, workspaceId, moduleId, body.enabled, body.confirm === true);
  }

  /** Visibility, not availability — see ModulesService.setRestricted. */
  @Patch(":moduleId/restrict")
  setRestricted(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("moduleId") moduleId: string,
    @Body(new ZodValidationPipe(setWorkspaceModuleRestrictionInputSchema)) body: SetWorkspaceModuleRestrictionInput
  ): Promise<WorkspaceModuleState[]> {
    return this.modules.setRestricted(user.userId, workspaceId, moduleId, body.restricted);
  }
}

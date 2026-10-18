import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import {
  assignWorkspaceSphereInputSchema,
  createSphereInputSchema,
  setWorkspaceFavoriteInputSchema,
  updateSphereInputSchema,
  updateUserPreferenceInputSchema,
  saveThemeInputSchema,
  type SaveThemeInput,
  type AssignWorkspaceSphereInput,
  type CreateSphereInput,
  type SetWorkspaceFavoriteInput,
  type UpdateSphereInput,
  type UpdateUserPreferenceInput,
  type UserPreference,
  type WorkspaceOrganization
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SettingsService } from "./settings.service";

@UseGuards(JwtAuthGuard)
@Controller("settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get("preferences")
  get(@CurrentUser() user: RequestUser): Promise<UserPreference> {
    return this.settings.get(user.userId);
  }

  @Patch("preferences")
  update(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateUserPreferenceInputSchema)) body: UpdateUserPreferenceInput
  ): Promise<UserPreference> {
    return this.settings.update(user.userId, body);
  }

  /** Own theme library — one theme per request, see SettingsService.saveTheme. */
  @Put("themes/:themeId")
  saveTheme(
    @CurrentUser() user: RequestUser,
    @Param("themeId") themeId: string,
    @Body(new ZodValidationPipe(saveThemeInputSchema)) body: SaveThemeInput
  ): Promise<UserPreference> {
    return this.settings.saveTheme(user.userId, themeId, body);
  }

  @Delete("themes/:themeId")
  deleteTheme(@CurrentUser() user: RequestUser, @Param("themeId") themeId: string): Promise<UserPreference> {
    return this.settings.deleteTheme(user.userId, themeId);
  }

  // U05 (24-CONNECTED-CORE-BACKLOG.md) — personal spheres + favorites. Not a
  // new workspace-scoped resource: no `workspaces/:workspaceId` prefix, this
  // is per-user account data (see SettingsService.getOrganization).

  @Get("organization")
  getOrganization(@CurrentUser() user: RequestUser): Promise<WorkspaceOrganization> {
    return this.settings.getOrganization(user.userId);
  }

  @Post("organization/spheres")
  createSphere(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createSphereInputSchema)) body: CreateSphereInput
  ): Promise<WorkspaceOrganization> {
    return this.settings.createSphere(user.userId, body.name);
  }

  @Patch("organization/spheres/:sphereId")
  updateSphere(
    @CurrentUser() user: RequestUser,
    @Param("sphereId") sphereId: string,
    @Body(new ZodValidationPipe(updateSphereInputSchema)) body: UpdateSphereInput
  ): Promise<WorkspaceOrganization> {
    return this.settings.updateSphere(user.userId, sphereId, body);
  }

  @Delete("organization/spheres/:sphereId")
  deleteSphere(@CurrentUser() user: RequestUser, @Param("sphereId") sphereId: string): Promise<WorkspaceOrganization> {
    return this.settings.deleteSphere(user.userId, sphereId);
  }

  @Put("organization/workspace-sphere")
  assignWorkspaceSphere(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(assignWorkspaceSphereInputSchema)) body: AssignWorkspaceSphereInput
  ): Promise<WorkspaceOrganization> {
    return this.settings.assignWorkspaceSphere(user.userId, body.workspaceId, body.sphereId);
  }

  @Put("organization/favorites/:workspaceId")
  setWorkspaceFavorite(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(setWorkspaceFavoriteInputSchema)) body: SetWorkspaceFavoriteInput
  ): Promise<WorkspaceOrganization> {
    return this.settings.setWorkspaceFavorite(user.userId, workspaceId, body.favorite);
  }
}
